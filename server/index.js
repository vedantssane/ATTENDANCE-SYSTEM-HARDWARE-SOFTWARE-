import http from 'node:http';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const root = resolve('.');
const staticRoot = join(root, 'dist');
const storePath = join(root, 'data/store.json');
const seedPath = join(root, 'data/store.example.json');
const sessions = new Set();
const scanCooldowns = new Map();
const cooldownMs = Number(process.env.SCAN_COOLDOWN_MS || 2500);
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'; // Development-only default.
const now = () => process.env.TEST_NOW || new Date().toISOString();
const today = () => now().slice(0, 10);

async function loadStore() {
  try { return JSON.parse(await readFile(storePath, 'utf8')); }
  catch {
    await mkdir(join(root, 'data'), { recursive: true });
    const store = JSON.parse(await readFile(seedPath, 'utf8'));
    store.scanEvents = [];
    await saveStore(store);
    return store;
  }
}
const saveStore = (store) => writeFile(storePath, JSON.stringify(store, null, 2));
const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
};
const parseBody = (req) => new Promise((resolve, reject) => {
  let raw = ''; req.on('data', (chunk) => { raw += chunk; if (raw.length > 100_000) req.destroy(); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON request body.')); } });
});
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((item) => item.trim().split('=')));
const isAdmin = (req) => sessions.has(cookies(req).attendance_session);
const studentFor = (store, attendance) => store.students.find((student) => student.id === attendance.studentId);
const detailedAttendance = (store, record) => ({ ...record, student: studentFor(store, record) });
function dashboard(store) {
  const records = store.attendance.filter((record) => record.attendanceDate === today());
  const successfulScans = (store.scanEvents || []).filter((event) => event.type === 'SUCCESS' && event.timestamp.slice(0, 10) === today());
  const activeStudents = store.students.filter((student) => student.active);
  const recent = [...store.attendance].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8).map((record) => detailedAttendance(store, record));
  return { totalStudents: activeStudents.length, signedIn: records.filter((record) => record.status === 'SIGNED_IN').length, signedOut: records.filter((record) => record.status === 'SIGNED_OUT').length, todayAttendance: records.length, totalScans: successfulScans.length, attendancePercentage: activeStudents.length ? Math.round((records.length / activeStudents.length) * 100) : 0, recent, lastScan: (store.scanEvents || []).at(-1) || null, systemStatus: 'ONLINE' };
}
function normalizedUid(value) { return String(value || '').toUpperCase().replace(/\s/g, ''); }
function publicStudent(student) { return { id: student.id, name: student.fullName, rollNumber: student.rollNumber }; }
function protectedRoute(req, res) { if (!isAdmin(req)) { send(res, 401, { success: false, error: 'UNAUTHORIZED' }); return true; } return false; }

async function api(req, res, url) {
  const method = req.method; const path = url.pathname; const store = await loadStore();
  if (method === 'GET' && path === '/api/auth/session') return send(res, 200, { authenticated: isAdmin(req) });
  if (method === 'POST' && path === '/api/auth/login') {
    const { password } = await parseBody(req); const input = Buffer.from(String(password || '')); const expected = Buffer.from(adminPassword);
    if (input.length !== expected.length || !timingSafeEqual(input, expected)) return send(res, 401, { success: false, error: 'INVALID_CREDENTIALS' });
    const token = randomUUID(); sessions.add(token);
    return send(res, 200, { success: true }, { 'Set-Cookie': `attendance_session=${token}; HttpOnly; SameSite=Strict; Path=/` });
  }
  if (method === 'POST' && path === '/api/auth/logout') { sessions.delete(cookies(req).attendance_session); return send(res, 200, { success: true }, { 'Set-Cookie': 'attendance_session=; Max-Age=0; Path=/' }); }
  if (method === 'GET' && path === '/api/dashboard') return send(res, 200, { success: true, ...dashboard(store) });

  // Intentionally public: this is the single future ESP32 integration endpoint.
  if (method === 'POST' && path === '/api/attendance/scan') {
    const body = await parseBody(req); const rfidUid = normalizedUid(body.rfid_uid ?? body.rfidUid);
    if (!rfidUid) return send(res, 400, { success: false, error: 'INVALID_RFID_UID', message: 'rfid_uid is required.' });
    const timestamp = now(); const student = store.students.find((item) => item.active && item.rfidUid === rfidUid);
    if (!student) { store.scanEvents = store.scanEvents || []; store.scanEvents.push({ type: 'ERROR', error: 'UNKNOWN_RFID', rfidUid, timestamp }); store.scanEvents = store.scanEvents.slice(-25); await saveStore(store); return send(res, 404, { success: false, error: 'UNKNOWN_RFID', message: 'No active student is assigned to this RFID card.' }); }
    const previous = scanCooldowns.get(rfidUid) || 0;
    if (Date.now() - previous < cooldownMs) return send(res, 429, { success: false, error: 'SCAN_COOLDOWN', message: 'Please wait before scanning this card again.' });
    // Each attendance row is an IN/OUT session. The most recent open session is closed;
    // otherwise a new session begins, allowing IN → OUT → IN → OUT throughout a day.
    const daySessions = store.attendance.filter((item) => item.studentId === student.id && item.attendanceDate === today()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    let attendance = daySessions.find((item) => item.status === 'SIGNED_IN');
    const action = attendance ? 'SIGNED_OUT' : 'SIGNED_IN'; scanCooldowns.set(rfidUid, Date.now());
    if (attendance) { attendance.signOutTime = timestamp; attendance.status = action; attendance.updatedAt = timestamp; }
    else { attendance = { id: randomUUID(), studentId: student.id, attendanceDate: today(), signInTime: timestamp, signOutTime: null, status: action, createdAt: timestamp, updatedAt: timestamp }; store.attendance.push(attendance); }
    store.scanEvents = store.scanEvents || []; store.scanEvents.push({ type: 'SUCCESS', action, student: publicStudent(student), timestamp }); store.scanEvents = store.scanEvents.slice(-25); await saveStore(store);
    return send(res, 200, { success: true, action, student: publicStudent(student), timestamp, attendance: detailedAttendance(store, attendance), summary: dashboard(store) });
  }

  if (protectedRoute(req, res)) return;
  if (method === 'GET' && path === '/api/students') return send(res, 200, { success: true, students: store.students });
  if (method === 'GET' && path === '/api/attendance') {
    const search = String(url.searchParams.get('search') || '').toLowerCase(); let rows = store.attendance;
    if (url.searchParams.get('date')) rows = rows.filter((row) => row.attendanceDate === url.searchParams.get('date'));
    if (url.searchParams.get('studentId')) rows = rows.filter((row) => row.studentId === url.searchParams.get('studentId'));
    const attendance = rows.map((row) => detailedAttendance(store, row)).filter((row) => !search || Object.values(row.student).join(' ').toLowerCase().includes(search)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return send(res, 200, { success: true, attendance });
  }
  if (method === 'POST' && path === '/api/students') {
    const input = await parseBody(req); const required = ['fullName', 'rollNumber', 'className', 'division'];
    if (required.some((key) => !String(input[key] || '').trim())) return send(res, 400, { success: false, error: 'VALIDATION_ERROR', message: 'Full name, roll number, class, and division are required.' });
    if (store.students.some((student) => student.rollNumber === String(input.rollNumber).trim())) return send(res, 409, { success: false, error: 'DUPLICATE_ROLL_NUMBER' });
    const uid = normalizedUid(input.rfidUid); if (uid && store.students.some((student) => student.active && student.rfidUid === uid)) return send(res, 409, { success: false, error: 'DUPLICATE_RFID_UID' });
    const timestamp = now(); const student = { id: randomUUID(), fullName: input.fullName.trim(), rollNumber: input.rollNumber.trim(), className: input.className.trim(), division: input.division.trim(), email: String(input.email || '').trim(), rfidUid: uid || null, active: true, createdAt: timestamp, updatedAt: timestamp };
    store.students.push(student); await saveStore(store); return send(res, 201, { success: true, student });
  }
  if (method === 'PATCH' && path.startsWith('/api/students/')) {
    const id = path.split('/').pop(); const input = await parseBody(req); const student = store.students.find((item) => item.id === id); if (!student) return send(res, 404, { success: false, error: 'STUDENT_NOT_FOUND' });
    const uid = input.rfidUid === undefined ? student.rfidUid : normalizedUid(input.rfidUid) || null; if (uid && store.students.some((item) => item.id !== id && item.active && item.rfidUid === uid)) return send(res, 409, { success: false, error: 'DUPLICATE_RFID_UID' });
    Object.assign(student, { ...input, rfidUid: uid, updatedAt: now() }); await saveStore(store); return send(res, 200, { success: true, student });
  }
  if (method === 'DELETE' && path.startsWith('/api/students/')) { const student = store.students.find((item) => item.id === path.split('/').pop()); if (!student) return send(res, 404, { success: false, error: 'STUDENT_NOT_FOUND' }); student.active = false; student.updatedAt = now(); await saveStore(store); return send(res, 200, { success: true, student }); }
  return send(res, 404, { success: false, error: 'NOT_FOUND' });
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => { const url = new URL(req.url, 'http://localhost'); try { if (url.pathname.startsWith('/api/')) return await api(req, res, url); let file = url.pathname === '/' ? '/src/index.html' : url.pathname; let target = join(staticRoot, file); try { await access(target); } catch { target = join(staticRoot, 'src/index.html'); } res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' }); createReadStream(target).pipe(res); } catch (error) { send(res, 500, { success: false, error: 'SERVER_ERROR', message: error.message }); } }).listen(process.env.PORT || 3000, () => console.log('RFID Attendance running on http://localhost:3000'));
