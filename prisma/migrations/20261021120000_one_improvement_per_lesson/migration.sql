-- One improvement per lesson: open improvements of one lesson that nothing was drafted or saved for
-- yet merge into the oldest. It takes their feedback (joined now, so a plan written before asks to be
-- updated), their discussion and their groups; an improvement made without feedback brings what it
-- asked for as a note. Plans are kept one after another. Improvements with changes drafted or saved,
-- sent to Obsidian, or covering several lessons finish as they are.
CREATE TEMP TABLE improvement_merge AS
WITH mergeable AS (
  SELECT t.id, t.created_at, min(l.entity_id) AS lesson_id
  FROM public.tasks t
  JOIN public.task_entity_links l ON l.task_id = t.id AND l.entity_type = 'lesson'
  WHERE t.kind = 'curriculum'
    AND t.status IN ('TODO', 'IN_PROGRESS')
    AND (t.workplace IS NULL OR t.workplace <> 'VAULT')
    AND NOT EXISTS (SELECT 1 FROM courses.lesson_changes c WHERE c.task_id = t.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_proposals p
      WHERE p.task_id = t.id AND p.kind = 'LESSON_REVISION' AND p.status IN ('PENDING', 'WORKING', 'OPEN')
    )
  GROUP BY t.id, t.created_at
  HAVING count(*) = 1 AND bool_and(l.role = 'subject')
),
ranked AS (
  SELECT id, lesson_id, created_at,
    first_value(id) OVER (PARTITION BY lesson_id ORDER BY created_at, id) AS into_id,
    count(*) OVER (PARTITION BY lesson_id) AS n
  FROM mergeable
)
SELECT id, lesson_id, into_id FROM ranked WHERE n > 1;

-- What an improvement without feedback asked for, as a note on the lesson that the merged one uses.
INSERT INTO courses.curriculum_comments
  (id, curriculum_version_id, lesson_id, group_id, author_user_id, is_instructor_note, proposer_name, selected_text, body, status, created_at, updated_at)
SELECT 'merged' || md5(m.id), le.curriculum_version_id, le.id, v.owner_group_id, t.created_by_id, true,
  coalesce(nullif(t.proposer_name, ''), 'Note'), le.title, left(trim(t.description), 4000), 'OPEN', t.created_at, now()
FROM improvement_merge m
JOIN public.tasks t ON t.id = m.id
JOIN courses.lessons le ON le.id = m.lesson_id
JOIN courses.curriculum_versions v ON v.id = le.curriculum_version_id
WHERE coalesce(trim(t.description), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.task_entity_links s WHERE s.task_id = t.id AND s.entity_type = 'curriculum_comment' AND s.role = 'source'
  );

INSERT INTO public.task_entity_links (id, task_id, entity_type, entity_id, role, created_at)
SELECT 'merged' || md5(m.id || ':link'), m.into_id, 'curriculum_comment', c.id, 'source', now()
FROM improvement_merge m
JOIN courses.curriculum_comments c ON c.id = 'merged' || md5(m.id);

-- Their feedback joins the oldest (a piece already there isn't added twice).
DELETE FROM public.task_entity_links s
USING improvement_merge m
WHERE s.task_id = m.id AND m.id <> m.into_id AND s.entity_type = 'curriculum_comment' AND s.role = 'source'
  AND EXISTS (
    SELECT 1 FROM public.task_entity_links x
    WHERE x.task_id = m.into_id AND x.entity_type = s.entity_type AND x.entity_id = s.entity_id AND x.role = s.role
  );

UPDATE public.task_entity_links s
SET task_id = m.into_id, created_at = now()
FROM improvement_merge m
WHERE s.task_id = m.id AND m.id <> m.into_id AND s.entity_type = 'curriculum_comment' AND s.role = 'source';

-- Their groups, so the groups' instructors still find it.
INSERT INTO public.task_entity_links (id, task_id, entity_type, entity_id, role, created_at)
SELECT DISTINCT ON (m.into_id, g.entity_id) 'merged' || md5(m.into_id || ':' || g.entity_id), m.into_id, 'course_group', g.entity_id, 'subject', now()
FROM improvement_merge m
JOIN public.task_entity_links g ON g.task_id = m.id AND g.entity_type = 'course_group'
WHERE m.id <> m.into_id
ON CONFLICT (task_id, entity_type, entity_id, role) DO NOTHING;

-- Their discussion.
UPDATE public.task_comments c
SET task_id = m.into_id
FROM improvement_merge m
WHERE c.task_id = m.id AND m.id <> m.into_id;

-- One plan (theirs one after another), in progress if any was, assigned as the first that was.
UPDATE public.tasks t
SET plan = merged.plan,
  plan_updated_at = CASE WHEN merged.plan IS NULL THEN NULL ELSE coalesce(t.plan_updated_at, merged.plan_at, t.created_at) END,
  status = CASE WHEN merged.started THEN 'IN_PROGRESS' ELSE t.status END,
  assignee_id = coalesce(t.assignee_id, merged.assignee_id),
  updated_at = now()
FROM (
  SELECT m.into_id,
    nullif(string_agg(nullif(trim(x.plan), ''), E'\n\n' ORDER BY x.created_at, x.id), '') AS plan,
    max(x.plan_updated_at) AS plan_at,
    bool_or(x.status = 'IN_PROGRESS') AS started,
    (array_agg(x.assignee_id ORDER BY x.created_at) FILTER (WHERE x.assignee_id IS NOT NULL))[1] AS assignee_id
  FROM improvement_merge m
  JOIN public.tasks x ON x.id = m.id
  GROUP BY m.into_id
) merged
WHERE t.id = merged.into_id;

DELETE FROM public.tasks t
USING improvement_merge m
WHERE t.id = m.id AND m.id <> m.into_id;

DROP TABLE improvement_merge;
