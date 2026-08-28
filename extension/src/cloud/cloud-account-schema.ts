import { z } from 'zod';
import type {
  ExtensionAccount,
  ExtensionCapabilities,
  ExtensionCaptureSettings,
} from './contracts/extension-cloud-v1';

const quotaSchema = z.object({
  limit: z.number().int().nonnegative().nullable(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative().nullable(),
  unlimited: z.boolean(),
}).strict();

const selectedModelSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  quotaCost: z.number().int().positive(),
}).strict();

export const extensionAccountSchema = z.object({
  emailMasked: z.string().min(3).max(254),
  plan: z.enum(['free', 'pro', 'advance']),
  currentPeriodEnd: z.string().nullable(),
  quota: quotaSchema,
  selectedModel: selectedModelSchema,
  entitlements: z.object({
    multiTimeframe: z.boolean(),
    maxCaptures: z.number().int().min(1).max(3),
  }).strict(),
}).strict();

export const extensionCapabilitiesSchema = z.object({
  edition: z.literal('cloud'),
  apiVersion: z.literal('1'),
  reportSchemaVersion: z.literal('extension-report-1.0'),
  limits: z.object({
    maxImages: z.number().int().min(1).max(3),
    maxTimeframes: z.number().int().min(1).max(3),
  }).strict(),
  features: z.object({
    multiTimeframe: z.boolean(),
    cloudManagedModels: z.boolean(),
    advancedAnnotations: z.boolean(),
    taskCancellation: z.boolean(),
    taskResume: z.boolean(),
  }).strict(),
}).strict();

export const extensionCaptureSettingsSchema = z.object({
  timeframes: z.array(z.object({
    role: z.enum(['context', 'setup', 'trigger']),
    timeframe: z.string().min(1).max(8),
  }).strict()).length(3),
}).strict();

export function parseExtensionAccount(value: unknown): ExtensionAccount {
  return extensionAccountSchema.parse(value) as ExtensionAccount;
}

export function parseExtensionCapabilities(value: unknown): ExtensionCapabilities {
  return extensionCapabilitiesSchema.parse(value) as ExtensionCapabilities;
}

export function parseExtensionCaptureSettings(value: unknown): ExtensionCaptureSettings {
  return extensionCaptureSettingsSchema.parse(value) as ExtensionCaptureSettings;
}
