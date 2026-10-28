-- Only first names are shown (DECISIONS #50).
-- 1. Treat tabs and non-breaking spaces like spaces, then drop surrounding whitespace.
UPDATE `user` SET `name` = trim(replace(replace(`name`, char(9), ' '), char(160), ' '));
--> statement-breakpoint
-- 2. Keep the first word.
UPDATE `user` SET `name` = substr(`name`, 1, instr(`name`, ' ') - 1) WHERE instr(`name`, ' ') > 0;
--> statement-breakpoint
-- 3. Admin history snapshots copied the name when they were written; show the short name there too.
UPDATE `audit_log` SET `after_json` = json_set(`after_json`, '$.name', (SELECT `name` FROM `user` WHERE `id` = json_extract(`after_json`, '$.userId')))
WHERE json_valid(`after_json`) AND json_extract(`after_json`, '$.name') IS NOT NULL
  AND EXISTS (SELECT 1 FROM `user` WHERE `id` = json_extract(`after_json`, '$.userId'));
--> statement-breakpoint
UPDATE `audit_log` SET `before_json` = json_set(`before_json`, '$.name', (SELECT `name` FROM `user` WHERE `id` = json_extract(`before_json`, '$.userId')))
WHERE json_valid(`before_json`) AND json_extract(`before_json`, '$.name') IS NOT NULL
  AND EXISTS (SELECT 1 FROM `user` WHERE `id` = json_extract(`before_json`, '$.userId'));
