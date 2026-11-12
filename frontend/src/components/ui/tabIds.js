// Ids that tie SegmentedTabs to the caller's panel (kept apart from the
// component so fast refresh keeps working).
export const tabId = (idBase, value) => `${idBase}-tab-${value}`;
export const panelId = (idBase) => `${idBase}-panel`;
