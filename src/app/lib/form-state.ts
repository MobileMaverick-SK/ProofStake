/** What a form action hands back when it could not finish: the reason, and the values to put back in the form. */
export interface FormState {
  error?: string;
  values?: Record<string, string>;
}
