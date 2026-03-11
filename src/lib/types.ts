/**
 * Types for the C2PA Conformance Tool.
 * Report format is crJSON (native) + conformance-tool metadata.
 */

import type { CrJson } from './crjson'

export type {
  CrJson,
  CrJsonManifestEntry,
  CrJsonValidationResults,
  CrJsonAssertionItem,
  CrJsonIngredientItem,
  CrJsonSignatureInfo,
  CrJsonClaimInfo
} from './crjson'

/** Report returned by processFile: crJSON (native format) plus conformance-tool metadata */
export interface ConformanceReport extends CrJson {
  usedITL?: boolean
  usedTestCerts?: boolean
  _conformanceToolVersion?: {
    commit: string
    shortCommit: string
    date: string
    branch: string
    generatedAt: string
  }
}

/** Re-export for components that still reference ValidationStatus from SDK */
export type { ValidationStatus } from '@contentauth/c2pa-web'

/** One validation status row in the report UI */
export interface ValidationStatusItem {
  code: string
  success: boolean
  isInterim?: boolean
  explanation?: string
}

/** Assertion summary row for display */
export interface AssertionSummaryItem {
  key: string
  value: unknown
  digitalSourceType?: string
  isAction?: boolean
  actionName?: string
  description?: string
}
