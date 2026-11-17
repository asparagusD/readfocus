import { fetchApi } from '../lib/api';
import { loadBookFile } from '../reader/fileStore';
import { bookSource } from './documentSource';

/** A book's original file for either renderer: this device's copy, else the signed URL (C17.2, C17.3). */
export const fromBook = (bookId) => bookSource(bookId, {
  loadDeviceFile: loadBookFile,
  fetchFile: (id) => fetchApi(`/books/${id}/file`),
});
