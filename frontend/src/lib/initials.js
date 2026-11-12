/**
 * The reader's initials for the account button (D4: real initials). From a
 * display name when Supabase has one in user_metadata, otherwise from the
 * email's local part split on dots, underscores, hyphens and pluses
 * ("fazle.rahman@x" -> "FR", "reader@x" -> "R"). At most two letters.
 */
export function displayName(user) {
  const meta = user?.user_metadata ?? {};
  const name = [meta.display_name, meta.full_name, meta.name].find((v) => typeof v === 'string' && v.trim());
  return name ? name.trim() : '';
}

export function initials(user) {
  const name = displayName(user);
  const source = name || (user?.email ?? '').split('@')[0];
  const words = source.split(/[\s._+-]+/).filter((w) => /\p{L}/u.test(w));
  const letters = words.map((w) => w.match(/\p{L}/u)[0].toLocaleUpperCase());
  if (letters.length === 0) return '?';
  return letters.length === 1 ? letters[0] : letters[0] + letters[letters.length - 1];
}
