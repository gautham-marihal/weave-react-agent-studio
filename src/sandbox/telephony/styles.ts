import { cn, inputClass, inputErrorClass } from '../../utils/styles';

/** An input's look in the Sandbox telephony forms, with the error border when it has one. */
export const fieldClass = (error?: string | false): string => cn(inputClass, error && inputErrorClass);
