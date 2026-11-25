-- The select policy joined its own table, so every signed-in read failed with
-- "infinite recursion detected in policy". Same meaning, without the join.
drop policy "Users can view contact custom fields" on contact_custom_fields;
create policy "Users can view contact custom fields"
  on contact_custom_fields for select
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_custom_fields.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );
