export type OperationType =
  | 'transferencia_enviada'
  | 'transferencia_recibida'
  | 'pago'
  | 'compra'
  | 'acreditacion'
  | 'debito'
  | 'aviso_movimiento'
  | 'desconocido';

export type SourceType = 'bank' | 'wallet';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ParsedEmailFields {
  providerId: string | null;
  providerName: string | null;
  sourceType: SourceType | null;
  operationType: OperationType;
  amount: number | null;
  currency: string;
  originAccount: string | null;
  destinationAccount: string | null;
  cbuOrCvu: string | null;
  senderName: string | null;
  recipientName: string | null;
  transactionId: string | null;
  occurredAt: string | null;
  description: string | null;
  detectedProviderConfidence: ConfidenceLevel;
  parsedAmountConfidence: ConfidenceLevel;
  parsedDateConfidence: ConfidenceLevel;
  requiresManualReview: boolean;
  warnings: string[];
  matchedPattern: string | null;
}
