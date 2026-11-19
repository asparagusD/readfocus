import { fetchApi } from '../lib/api';
import { cachedBookFile } from '../reader/fileCache';
import { loadBookFile } from '../reader/fileStore';
import { bookSource, openedFirst } from './documentSource';

const askFile = (id) => fetchApi(`/books/${id}/file`);

/** A book's original file for either renderer: this device's copy, else the signed URL (C17.2, C17.3). */
export const fromBook = (bookId) => bookSource(bookId, { loadDeviceFile: loadBookFile, fetchFile: askFile, cachedFile: cachedBookFile });

/** C34.3: as fromBook, but the first read uses the URL GET /books/{id}/open already gave (`opened`). */
export const fromOpenedBook = (opened) => {
  const fetchFile = openedFirst(opened, askFile);
  return (bookId) => bookSource(bookId, { loadDeviceFile: loadBookFile, fetchFile, cachedFile: cachedBookFile });
};
