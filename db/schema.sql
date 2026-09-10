-- PostgreSQL / Supabase production schema. Apply with your migration tool.
create table students (
  id uuid primary key default gen_random_uuid(), full_name text not null,
  roll_number text not null unique, class text not null, division text not null,
  email text, rfid_uid text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index active_students_rfid_uid_unique on students (rfid_uid) where active and rfid_uid is not null;
create table attendance (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references students(id),
  attendance_date date not null, sign_in_time timestamptz not null, sign_out_time timestamptz,
  status text not null check (status in ('SIGNED_IN','SIGNED_OUT')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(student_id, attendance_date)
);
create index attendance_date_idx on attendance(attendance_date desc);
create index attendance_student_date_idx on attendance(student_id, attendance_date desc);
