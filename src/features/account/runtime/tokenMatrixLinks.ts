import { openAccountExternalUrl } from "../../../services/accountExternalLinks";

export const TOKEN_MATRIX_API_KEYS_URL_V1 = "https://token-matrix.com/keys" as const;

export async function openTokenMatrixApiKeysV1(): Promise<void> {
  await openAccountExternalUrl(TOKEN_MATRIX_API_KEYS_URL_V1);
}
