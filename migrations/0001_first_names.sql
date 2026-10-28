-- Only first names are shown (DECISIONS #50): shorten names that were stored in full from Google.
UPDATE `user` SET `name` = substr(trim(`name`), 1, instr(trim(`name`), ' ') - 1) WHERE instr(trim(`name`), ' ') > 0;
