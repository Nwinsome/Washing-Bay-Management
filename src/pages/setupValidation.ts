export type SetupValues = { businessName: string; phone: string; address: string; fullName: string; username: string; password: string; confirmPassword: string };
export type FieldErrors = Partial<Record<keyof SetupValues, string>>;
export const initialValues: SetupValues = { businessName: '', phone: '', address: '', fullName: '', username: '', password: '', confirmPassword: '' };
export function validateStep(values: SetupValues, step: 1 | 2): FieldErrors {
  const errors: FieldErrors = {};
  const fields: [keyof SetupValues, string, number][] = step === 1 ? [['businessName', 'business name', 120], ['phone', 'business phone', 40], ['address', 'business address', 500]] : [['fullName', 'full name', 120], ['username', 'username', 64]];
  for (const [field, label, limit] of fields) {
    if (!values[field].trim()) errors[field] = `Enter your ${label}.`;
    else if (values[field].trim().length > limit) errors[field] = `Use ${limit} characters or fewer.`;
  }
  if (step === 1 && !errors.phone && (!/^[+\d\s().-]+$/.test(values.phone.trim()) || values.phone.replace(/\D/g, '').length < 7 || values.phone.replace(/\D/g, '').length > 15)) errors.phone = 'Enter a phone number with 7 to 15 digits. Use digits, spaces, +, parentheses or hyphens.';
  if (step === 2) {
    if (values.password.length < 8) errors.password = 'Use at least 8 characters.';
    else if (new TextEncoder().encode(values.password).length > 72) errors.password = 'Use a shorter password (maximum 72 UTF-8 bytes).';
    if (!values.confirmPassword) errors.confirmPassword = 'Confirm your password.';
    else if (values.password !== values.confirmPassword) errors.confirmPassword = 'The passwords do not match.';
  }
  return errors;
}
