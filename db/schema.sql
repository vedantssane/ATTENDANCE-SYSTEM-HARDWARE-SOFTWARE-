-- PostgreSQL / Supabase production schema. Each attendance row is one IN/OUT session.
create table students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  roll_number text not null unique check (length(trim(roll_number)) > 0),
  class text not null, division text not null, email text,
  rfid_uid text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index active_students_rfid_uid_unique
  on students (rfid_uid) where active and rfid_uid is not null;

create table attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  attendance_date date not null,
  sign_in_time timestamptz not null,
  sign_out_time timestamptz,
  status text not null check (status in ('SIGNED_IN','SIGNED_OUT')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((status = 'SIGNED_IN' and sign_out_time is null) or (status = 'SIGNED_OUT' and sign_out_time is not null)),
  check (sign_out_time is null or sign_out_time >= sign_in_time)
);
create index attendance_date_idx on attendance(attendance_date desc);
create index attendance_student_date_idx on attendance(student_id, attendance_date desc);
create index attendance_open_session_idx on attendance(student_id, attendance_date) where status = 'SIGNED_IN';
