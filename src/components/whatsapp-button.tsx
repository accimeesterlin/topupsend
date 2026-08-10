"use client";

import React from "react";
import { Button } from "@topupsend/ui";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { sanitizePhoneForWhatsApp } from "@/lib/utils";

export interface WhatsAppButtonProps {
  phoneNumber: string;
  size?: "sm" | "default";
  className?: string;
}

export const WhatsAppButton: React.FC<WhatsAppButtonProps> = ({
  phoneNumber,
  size = "sm",
  className,
}) => {
  const sanitized = sanitizePhoneForWhatsApp(phoneNumber);
  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 ${className || ""}`}
      asChild
      title={`Message ${phoneNumber} on WhatsApp`}
    >
      <a
        href={`https://wa.me/${sanitized}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        <WhatsAppIcon className={iconSize} />
      </a>
    </Button>
  );
};
