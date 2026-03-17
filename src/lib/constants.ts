/**
 * Constants for C2PA validation and certificate management
 */

// C2PA Validation Status Codes
export const VALIDATION_STATUS = {
  SIGNING_CREDENTIAL_TRUSTED: 'signingCredential.trusted',
  SIGNING_CREDENTIAL_UNTRUSTED: 'signingCredential.untrusted',
  SIGNING_CREDENTIAL_EXPIRED: 'signingCredential.expired',
  SIGNING_CREDENTIAL_OCSP_NOT_REVOKED: 'signingCredential.ocsp.notRevoked',
  SIGNING_CREDENTIAL_OCSP_REVOKED: 'signingCredential.ocsp.revoked',
  SIGNING_CREDENTIAL_OCSP_SKIPPED: 'signingCredential.ocsp.skipped',
  SIGNING_CREDENTIAL_OCSP_INACCESSIBLE: 'signingCredential.ocsp.inaccessible',
  TIMESTAMP_TRUSTED: 'timeStamp.trusted',
  TIMESTAMP_UNTRUSTED: 'timeStamp.untrusted',
  TIMESTAMP_VALIDATED: 'timeStamp.validated',
  CLAIM_SIGNATURE_VALIDATED: 'claimSignature.validated',
  CLAIM_SIGNATURE_INVALID: 'claimSignature.invalid',
  CLAIM_SIGNATURE_INSIDE_VALIDITY: 'claimSignature.insideValidity',
  TIME_OF_SIGNING_INSIDE_VALIDITY: 'timeOfSigning.insideValidity',
  ASSERTION_HASHED_URI_MATCH: 'assertion.hashedURI.match',
  ASSERTION_DATA_HASH_MATCH: 'assertion.dataHash.match',
  CAWG_ICA_CREDENTIAL_VALID: 'cawg.ica.credential_valid'
} as const

// Certificate OIDs
export const CERTIFICATE_OID = {
  COMMON_NAME: '2.5.4.3',
  COUNTRY_NAME: '2.5.4.6',
  STATE_OR_PROVINCE: '2.5.4.8',
  LOCALITY: '2.5.4.7',
  ORGANIZATION: '2.5.4.10',
  ORGANIZATIONAL_UNIT: '2.5.4.11',
  EMAIL: '1.2.840.113549.1.9.1',
  SUBJECT_ALT_NAME: '2.5.29.17',
  BASIC_CONSTRAINTS: '2.5.29.19',
  KEY_USAGE: '2.5.29.15',
  EXTENDED_KEY_USAGE: '2.5.29.37',
  AUTHORITY_KEY_IDENTIFIER: '2.5.29.35',
  SUBJECT_KEY_IDENTIFIER: '2.5.29.14',
  CRL_DISTRIBUTION_POINTS: '2.5.29.31'
} as const

// Extended Key Usage OIDs
export const EXTENDED_KEY_USAGE_OID = {
  SERVER_AUTH: '1.3.6.1.5.5.7.3.1',
  CLIENT_AUTH: '1.3.6.1.5.5.7.3.2',
  CODE_SIGNING: '1.3.6.1.5.5.7.3.3',
  EMAIL_PROTECTION: '1.3.6.1.5.5.7.3.4',
  TIME_STAMPING: '1.3.6.1.5.5.7.3.8',
  OCSP_SIGNING: '1.3.6.1.5.5.7.3.9'
} as const

// PEM certificate markers
export const PEM_MARKERS = {
  CERT_BEGIN: '-----BEGIN CERTIFICATE-----',
  CERT_END: '-----END CERTIFICATE-----',
  TRUSTED_CERT_BEGIN: '-----BEGIN TRUSTED CERTIFICATE-----',
  TRUSTED_CERT_END: '-----END TRUSTED CERTIFICATE-----'
} as const
