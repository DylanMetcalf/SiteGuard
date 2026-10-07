---
name: add-document-blueprint
description: Add or improve a Document Studio blueprint (a professional safety document type such as a procedure, plan, register or appointment letter). Use when someone asks COMVERA to produce a new kind of document, or to improve the content of an existing one.
---

# Adding a Document Studio blueprint

Blueprints live in `src/lib/studio/blueprints.ts`. Each one asks a few questions and builds a
`DocContent` (sections of paragraphs, bullets, numbered steps, tables, key-value fields, notes and
sign-off blocks). The PDF and Word renderers and the AI tailoring use that model, so a new
blueprint needs no renderer or UI changes.

## Steps

1. **Pick the category** from `CATEGORIES` (add a category only if none fits) and a short unique
   `code` (2–5 capitals) used in document numbers, e.g. `LP` for a lift plan.
2. **Write the fields**: as few as possible. Reuse `common.site`, `common.scope`,
   `common.supervisor`, `common.safetyOfficer`. Mark only truly necessary fields `required`.
   Select fields must list every option.
3. **Write `build()`** with the helpers (`sec`, `para`, `bullets`, `numbered`, `note`,
   `purposeScope`, `legalSection`, `responsibilities`, `hazardTable`, `ppeFor`, `emergencyBlocks`,
   `recordsReview`, `signOff`). Follow the structure SHE departments expect: purpose, scope, legal
   and other requirements, responsibilities, the procedure or content, controls, PPE, emergency,
   records, review, sign-off. It must produce a complete, usable document **with every field
   empty**; the tests build every blueprint that way.
4. **Legal references**: only cite sections or regulations you are certain of (see `LEGAL_CORE`);
   otherwise describe the requirement in words. Keep the `CONFIRM` note.
5. **`matches`**: a regex for starter-pack or site requirement names this document satisfies, so
   the requirement sheet offers "Create it in Document Studio". Check it doesn't catch unrelated
   names (see the mapping test in `test/studio.test.ts`).
6. **`guidance`**: one or two sentences telling the AI what "good" looks like for this document.
7. **Register it** in `BLUEPRINTS`.
8. **Hazards**: if the document introduces a new hazard, add its specific controls to
   `HAZARD_CONTROLS` in `src/lib/knowledge.ts` so risk registers never pair a hazard with an
   unrelated control.
9. **Test**: add a mapping assertion in `test/studio.test.ts` if you added `matches`; run
   `npm test` (every blueprint is rendered to PDF and Word there). Render one sample locally and
   look at it (`pdftoppm` or LibreOffice) before shipping.
10. **Docs**: mention the new document type in `README.md` (Document Studio paragraph).

## Quality bar

A mine SHE manager should be able to approve the document with only site-specific details filled
in. No filler text, no invented legal references, controls that match their hazards, and a sign-off
block at the end.
