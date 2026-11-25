-- When they last wrote in this chat: Instagram, Facebook and WhatsApp only take messages
-- for 24 hours after that. Set by the webhook and by the tagger, which reads the chat.
alter table conversations add column last_inbound_at timestamptz;

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  body text not null,
  button_label text,
  button_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create trigger set_updated_at before update on message_templates
  for each row execute function update_updated_at();

alter table message_templates enable row level security;
create policy "Users can manage message templates in their workspaces"
  on message_templates for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));
grant select, insert, update, delete on message_templates to authenticated, service_role;

-- Recent chats are read again so their 24-hour window is known from the start.
update contact_tagging set due_at = now()
where contact_id in (
  select contact_id from conversations
  where late_conversation_id is not null and last_message_at > now() - interval '3 days'
);
