-- One attendance register for every kind of session: toolbox talks, site inductions,
-- awareness training, briefings, safety meetings and training. Signing an induction
-- session at a site counts as that worker's induction for the site's gate clearance.
alter table toolbox_talks add column kind text not null default 'toolbox'
  check (kind in ('toolbox', 'induction', 'awareness', 'briefing', 'meeting', 'training'));
alter table toolbox_talks add column duration_minutes integer check (duration_minutes between 1 and 1440);
create index toolbox_attendance_worker_idx on toolbox_attendance (worker_id) where worker_id is not null;
