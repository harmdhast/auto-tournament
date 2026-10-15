/** A one-time code or key shown once, for the admin to copy. */
export type Secret = {
  kind: 'code' | 'key';
  value: string;
  expiresAt: number | null;
  name: string;
};
