# AI Chat Generated-Image Editing — Companion Server Contract Verification

## Result

**All companion-server contract tests pass.** No server code changes were
required — the existing contract already satisfies every desktop-facing
requirement in
[`ai-chat-generated-image-editing-incomplete-todos.md`](./ai-chat-generated-image-editing-incomplete-todos.md)
(P2-5).

- **Repository**: `/home/robertzeng/project/aifetchserver`
- **Verified commit**: `ea7fbe57361ec24049337d32904f94d2de65d135`
  (`ea7fbe5 chore(small-model): alembic migration for api_settings.is_small_model`)
- **Command**:

```bash
.venv/bin/python -m pytest \
  tests/unit/test_chat_image_input.py \
  tests/unit/test_chat_image_orchestrator.py \
  tests/unit/test_chat_image_handoff_intent.py \
  tests/unit/test_edit_image_orchestrator.py \
  tests/unit/test_openai_compatible_edit_image.py \
  tests/integration/test_chat_image_handoff.py -q
```

- **Outcome**: `102 passed, 11 warnings in 0.87s` (warnings are pre-existing
  Pydantic V2 deprecations, unrelated to image handling).

## Contract items (TODO P2-5) → evidence

| Requirement | Evidence |
|---|---|
| Attached data URLs become image-edit references | `tests/unit/test_chat_image_orchestrator.py`, `test_chat_image_input.py` (data-URL attachments feed the edit path) |
| Explicit edit intent activates image editing | `tests/unit/test_chat_image_handoff_intent.py` (21 tests over intent classification) |
| Multiple references preserve order | `tests/unit/test_chat_image_input.py` (ordered reference handling) |
| Independent edits and fusion prompts route differently | `tests/unit/test_edit_image_orchestrator.py` (fusion vs independent routing cases) |
| Streaming returns final image metadata | `test_openai_compatible_edit_image.py::test_streaming_explicit_edit_returns_image_delta_for_update_backgroud_prompt` asserts `delta.images` frames |
| Count and payload limits remain enforced | `tests/unit/test_chat_image_input.py` (`_strict_limits` incl. `max_images: 3`, size/dimension checks) |
| Server logs never contain data URLs or image bytes | `redact_generated_image_artifacts` helper imported and asserted in `test_openai_compatible_edit_image.py` |

## Conclusion

The desktop's outbound contract (bounded `data:image/...;base64` content
parts, ≤3 per request, ordered) is fully honored by the companion server at
the verified commit. No desktop-contract failure was found, so per the task
plan no server changes were made.
