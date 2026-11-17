/** One line for the whole notepad (C22.2): the worst save state among its notes. */
export function overallStatus(statuses, ids) {
  const of = ids.map((id) => statuses[id]?.status ?? 'saved');
  if (of.some((s) => s === 'conflict' || s === 'error')) return 'Some notes are not saved';
  if (of.includes('offline')) return 'Offline · kept on this device, saved when you are back';
  if (of.some((s) => s === 'saving' || s === 'unsaved')) return 'Saving…';
  return ids.length ? 'All notes saved' : '';
}
