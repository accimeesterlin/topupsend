import { z } from 'zod';
import { TransactionStatus } from '@topupsend/types';

/**
 * Validation schema for updating transaction status
 */
export const updateTransactionStatusSchema = z.object({
  status: z.nativeEnum(TransactionStatus, {
    errorMap: () => ({
      message: `Status must be one of: ${Object.values(TransactionStatus).join(', ')}`,
    }),
  }),
  reason: z
    .string()
    .min(1, 'Reason cannot be empty')
    .max(500, 'Reason must be less than 500 characters')
    .optional(),
});

export type UpdateTransactionStatusInput = z.infer<typeof updateTransactionStatusSchema>;

/**
 * Additional validation rules for status updates
 */
export function validateStatusUpdate(
  currentStatus: TransactionStatus,
  newStatus: TransactionStatus
): { valid: boolean; error?: string } {
  // Prevent updating to the same status
  if (currentStatus === newStatus) {
    return {
      valid: false,
      error: 'Transaction already has this status',
    };
  }

  // Define valid status transitions
  const validTransitions: Record<TransactionStatus, TransactionStatus[]> = {
    [TransactionStatus.PENDING]: [
      TransactionStatus.PAID,
      TransactionStatus.FAILED,
      TransactionStatus.PROCESSING,
    ],
    [TransactionStatus.PAID]: [
      TransactionStatus.PROCESSING,
      TransactionStatus.FAILED,
      TransactionStatus.REFUNDED,
    ],
    [TransactionStatus.PROCESSING]: [
      TransactionStatus.COMPLETED,
      TransactionStatus.FAILED,
    ],
    [TransactionStatus.COMPLETED]: [
      TransactionStatus.REFUNDED,
    ],
    [TransactionStatus.FAILED]: [
      TransactionStatus.PENDING, // Allow retry
      TransactionStatus.REFUNDED, // Allow manual refund
    ],
    [TransactionStatus.REFUNDED]: [], // No transitions from refunded
  };

  const allowedTransitions = validTransitions[currentStatus] || [];

  if (!allowedTransitions.includes(newStatus)) {
    return {
      valid: false,
      error: `Cannot transition from ${currentStatus} to ${newStatus}. Allowed transitions: ${allowedTransitions.join(', ') || 'none'}`,
    };
  }

  return { valid: true };
}

/**
 * Check if a reason is required for the status update
 */
export function isReasonRequired(newStatus: TransactionStatus): boolean {
  return newStatus === TransactionStatus.FAILED || newStatus === TransactionStatus.REFUNDED;
}
