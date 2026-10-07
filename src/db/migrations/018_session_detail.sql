-- Sessions record their start time, the work being done and the tools in use (whose hazards
-- and controls are added to the talk). A session dated in the future is scheduled.
alter table toolbox_talks
  add column start_time text check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column work_type  text not null default '',
  add column tools      text[] not null default '{}';
