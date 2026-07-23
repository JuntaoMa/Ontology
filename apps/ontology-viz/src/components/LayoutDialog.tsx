import { useEffect, useRef } from "react";

import { LAYOUT_OPTIONS, type LayoutMode } from "../graph";

export interface LayoutDialogProps {
  open: boolean;
  value: LayoutMode;
  onClose: () => void;
  onChange: (value: LayoutMode) => void;
}

export function LayoutDialog({ open, value, onClose, onChange }: LayoutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="settings-dialog__header">
        <h2>布局设置</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="settings-dialog__body">
        <fieldset>
          <legend>布局</legend>
          <div className="layout-options">
            {LAYOUT_OPTIONS.map((option) => (
              <label key={option.value} className="layout-option">
                <input
                  type="radio"
                  name="layout"
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => onChange(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </dialog>
  );
}
