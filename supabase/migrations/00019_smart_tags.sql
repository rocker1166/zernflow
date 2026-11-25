-- Smart tags: grouped tags, and a queue of contacts whose tags must be worked out again.

-- null = a plain tag made by a flow; set = a smart tag and the group it belongs to.
alter table tags add column category text;

-- The tagger only ever adds or removes its own ('auto') rows.
alter table contact_tags add column source text not null default 'manual'
  check (source in ('manual', 'auto'));
create index idx_contact_tags_tag on contact_tags(tag_id);

create table contact_tagging (
  contact_id uuid primary key references contacts(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  due_at timestamptz,
  attempts int not null default 0,
  last_error text,
  tagged_at timestamptz,
  -- what was asked last time and the answers, so an unchanged chat is not asked again
  hash text,
  answers jsonb,
  input_tokens int not null default 0
);
create index idx_contact_tagging_due on contact_tagging(due_at) where due_at is not null;

-- Service role only: no policies.
alter table contact_tagging enable row level security;
revoke all on contact_tagging from anon, authenticated;

-- 45 s later, so a burst of messages is read once and the flow's own answer is already in.
create function queue_contact_tagging(p_contact_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into contact_tagging (contact_id, workspace_id, due_at)
  select id, workspace_id, now() + interval '45 seconds' from contacts where id = p_contact_id
  on conflict (contact_id) do update set due_at = excluded.due_at, attempts = 0;
$$;
revoke execute on function queue_contact_tagging(uuid) from public, anon, authenticated;

create function queue_tagging_from_contact_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform queue_contact_tagging(new.contact_id);
  return null;
end $$;

create function queue_tagging_from_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform queue_contact_tagging(new.id);
  return null;
end $$;

create function queue_tagging_from_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform queue_contact_tagging(cc.contact_id)
  from contact_channels cc
  where cc.channel_id = new.channel_id and cc.platform_sender_id = new.author_id;
  return null;
end $$;

create trigger tag_on_conversation_insert after insert on conversations
  for each row execute function queue_tagging_from_contact_id();
create trigger tag_on_conversation_message after update of last_message_at on conversations
  for each row when (old.last_message_at is distinct from new.last_message_at)
  execute function queue_tagging_from_contact_id();
create trigger tag_on_flow_status after update of status on flow_sessions
  for each row when (old.status is distinct from new.status)
  execute function queue_tagging_from_contact_id();
create trigger tag_on_comment after insert or update on comment_logs
  for each row execute function queue_tagging_from_comment();
create trigger tag_on_subscription after update of is_subscribed on contacts
  for each row when (old.is_subscribed is distinct from new.is_subscribed)
  execute function queue_tagging_from_contact();

-- Everyone already here is due now.
insert into contact_tagging (contact_id, workspace_id, due_at)
select id, workspace_id, now() from contacts;
