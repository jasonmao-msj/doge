## 1. OpenSpec & i18n

- [x] 1.1 proposal / design / specs
- [x] 1.2 sharedSend keys: auto-handle, skip, details dialog, single-line summary, advanced labels (zh + en + locale parity)

## 2. UI implementation

- [x] 2.1 SharedSendStatusBar: collapsed single-line layout + expand panel
- [x] 2.2 Auto-handle serial ladder (owner → recover → interrupt → rebuild)
- [x] 2.3 Skip-turn via ConfirmDialog (no window.confirm)
- [x] 2.4 Details via in-app AlertDialog
- [x] 2.5 Advanced: probe / stop (disabled without attempt) / rebuild
- [x] 2.6 shared-send-status.css single-line styles

## 3. Tests

- [x] 3.1 Update SharedSendStatusBar tests for new labels & ConfirmDialog
- [x] 3.2 Auto-handle success/failure paths
- [x] 3.3 Skip cancel does not abandon; confirm abandons
- [x] 3.4 locale parity green

## 4. Verify

- [x] 4.1 vitest SharedSendStatusBar + sharedSendLocaleParity
- [x] 4.2 no window.confirm in recovery path (rg)
