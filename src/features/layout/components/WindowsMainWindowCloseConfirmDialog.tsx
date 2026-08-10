/**
 * Custom (non-native) close confirmation for Windows main-window titlebar X.
 * Isolated from macOS/Linux chrome and system menus.
 */
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";

export type WindowsMainWindowCloseConfirmDialogProps = {
  open: boolean;
  isClosing?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function WindowsMainWindowCloseConfirmDialog({
  open,
  isClosing = false,
  onCancel,
  onConfirm,
}: WindowsMainWindowCloseConfirmDialogProps) {
  const { t } = useTranslation();
  const appName = t("app.title", { defaultValue: "doge" });

  const handleCancel = () => {
    if (isClosing) {
      return;
    }
    onCancel();
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel();
        }
      }}
    >
      <AlertDialogPopup
        className="windows-main-window-close-confirm-dialog max-w-md"
        bottomStickOnMobile={false}
        modalLayer
        data-testid="windows-main-window-close-confirm"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("menu.closeWindowConfirmTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("menu.closeWindowConfirmMessage", { appName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <button
            type="button"
            className="ghost"
            onClick={handleCancel}
            disabled={isClosing}
            data-testid="windows-main-window-close-confirm-cancel"
          >
            {t("menu.closeWindowConfirmCancel")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void onConfirm();
            }}
            disabled={isClosing}
            data-testid="windows-main-window-close-confirm-ok"
          >
            {isClosing
              ? t("menu.closeWindowConfirmBusy")
              : t("menu.closeWindowConfirmOk")}
          </button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
