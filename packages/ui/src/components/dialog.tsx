"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../lib/utils";

// Symbol to identify DialogTrigger components reliably
const DIALOG_TRIGGER_SYMBOL = Symbol('DialogTrigger');

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined);

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open: controlledOpen, onOpenChange, children }: DialogProps) {
  const [mounted, setMounted] = React.useState(false);
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const handleOpenChange = onOpenChange || setUncontrolledOpen;

  return (
    <DialogContext.Provider value={{ open, onOpenChange: handleOpenChange }}>
      {/* Render triggers outside of portal */}
      {React.Children.toArray(children).map((child, index) => {
        if (React.isValidElement(child) && (child as any).type?.[DIALOG_TRIGGER_SYMBOL]) {
          return <React.Fragment key={index}>{child}</React.Fragment>;
        }
        return null;
      })}

      {/* Only render dialog content in portal when open and mounted */}
      {open && mounted && typeof window !== 'undefined' && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/50 animate-in fade-in-0"
            onClick={() => handleOpenChange(false)}
          />
          {/* Dialog */}
          <div className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] p-4 animate-in fade-in-0 zoom-in-95">
            {children}
          </div>
        </>,
        document.body
      )}
    </DialogContext.Provider>
  );
}

interface DialogTriggerProps {
  children: React.ReactElement;
  asChild?: boolean;
}

export function DialogTrigger({ children, asChild }: DialogTriggerProps) {
  const context = React.useContext(DialogContext);
  if (!context) {
    throw new Error("DialogTrigger must be used within a Dialog");
  }

  const { onOpenChange } = context;

  if (asChild && React.isValidElement(children)) {
    const childProps = children.props as any;
    return React.cloneElement(children, {
      onClick: (e: React.MouseEvent) => {
        childProps.onClick?.(e);
        onOpenChange(true);
      },
    } as any);
  }

  return (
    <button onClick={() => onOpenChange(true)} type="button">
      {children}
    </button>
  );
}

// Mark the component with our symbol so Dialog can find it reliably
(DialogTrigger as any)[DIALOG_TRIGGER_SYMBOL] = true;

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogContent({ children, className }: DialogContentProps) {
  return (
    <div
      className={cn(
        "bg-background border rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto",
        className
      )}
    >
      {children}
    </div>
  );
}

interface DialogHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return <div className={cn("mb-4", className)}>{children}</div>;
}

interface DialogTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogTitle({ children, className }: DialogTitleProps) {
  return <h2 className={cn("text-lg font-semibold", className)}>{children}</h2>;
}

interface DialogDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogDescription({ children, className }: DialogDescriptionProps) {
  return <p className={cn("text-sm text-muted-foreground mt-1", className)}>{children}</p>;
}

interface DialogFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)}>{children}</div>;
}
