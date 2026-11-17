import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Trash2, Upload } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { fadeIn, rise, shelfArrive, stagger } from '../motion/presets';
import { fetchApi } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/TextInput';
import { useToast } from '../components/ui/toastContext';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { MasteryBar } from '../components/ui/MasteryBar';
import { BookCover } from '../components/BookCover';
import { EmptyShelf, OpenBook } from '../illustrations';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { forgetBookFile, saveBookFile } from '../reader/fileStore';
import './Library.css';

// Files a reader can add (C19.2c): PDF and EPUB open as they are; Markdown (alone, or zipped with its
// images) and Jupyter notebooks are converted to an EPUB on the server.
const ACCEPTED = ['pdf', 'epub', 'md', 'markdown', 'zip', 'ipynb'];
const CONVERTED = ['md', 'markdown', 'zip', 'ipynb'];

/** The toast for images a converted book left out (remote ones are never downloaded). */
function missingImages(notes) {
  const n = notes.length;
  return `${n} ${n === 1 ? 'image' : 'images'} couldn’t be included: ${notes.slice(0, 2).map((note) => note.replace(/^Image not included: /, '')).join('; ')}${n > 2 ? ` and ${n - 2} more` : ''}.`;
}

/** Share of the book read so far, 0-100, from GET /books's progress. */
function readPct(book) {
  if (!book.progress || !book.total_chunks) return 0;
  return Math.min(100, Math.round((book.progress.chunks_completed / book.total_chunks) * 100));
}

/** The book to open next: the one read most recently, else the newest ready one. */
function nextBook(books) {
  const ready = books.filter((b) => b.status === 'ready');
  const read = ready.filter((b) => b.progress?.updated_at).sort((a, b) => b.progress.updated_at.localeCompare(a.progress.updated_at));
  if (read.length) return read[0];
  return [...ready].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0] ?? null;
}

function caption(book, pct) {
  if (book.status === 'error') return 'We couldn’t read this file';
  if (book.status !== 'ready') return pct == null ? 'Reading the pages…' : `Reading the pages… ${pct}%`;
  return book.progress ? `${readPct(book)}% read` : 'New · not started';
}

function ShelfSkeleton() {
  return (
    <div className="rf-library" aria-busy="true" aria-label="Loading your shelf">
      <Skeleton width={260} height={44} />
      <Skeleton width={200} height={14} className="rf-library__skel-line" />
      <Skeleton height={128} className="rf-library__skel-card" />
      <Skeleton width={120} height={12} />
      <div className="rf-shelf">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i}>
            <Skeleton className="rf-shelf__skel-cover" />
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Library() {
  useDocumentTitle('Your shelf');
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { toast } = useToast();
  const navigate = useNavigate();
  const [ingest, setIngest] = useState({}); // book id -> percent of its pages the ingestion job has read
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(null); // the book whose removal is being confirmed
  const [isRemoving, setIsRemoving] = useState(false);
  const [arrived, setArrived] = useState(() => new Set()); // books that turned ready while the shelf was open
  const reduced = useReducedMotion();

  // Upload state
  const fileInputRef = useRef(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const converting = CONVERTED.includes(selectedFile?.name.split('.').pop().toLowerCase());
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [uploadErrors, setUploadErrors] = useState({});
  const [deviceOnly, setDeviceOnly] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const loadBooks = useCallback(async () => {
    try {
      const data = await fetchApi('/books');
      setBooks(data);
      setError(null);
    } catch (err) {
      setError('We couldn’t open your shelf just now.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const retry = () => {
    setLoading(true);
    loadBooks();
  };

  const confirmRemove = async () => {
    const book = removing;
    setIsRemoving(true);
    try {
      await fetchApi(`/books/${book.id}`, { method: 'DELETE' });
      forgetBookFile(book.id);
      setBooks(prev => prev.filter(b => b.id !== book.id));
      setRemoving(null);
      toast({ kind: 'neutral', message: `${book.title} is off your shelf.` });
    } catch (err) {
      toast({ kind: 'warning', message: `We couldn’t remove ${book.title}: ${err.message}` });
    } finally {
      setIsRemoving(false);
    }
  };

  // Polling logic for processing books
  useEffect(() => {
    const hasProcessing = books.some(b => b.status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(async () => {
      // Reload the list for statuses, and ask each processing book how far its pages are read.
      try {
        const data = await fetchApi('/books');
        const was = new Map(books.map((b) => [b.id, b.status]));
        for (const book of data) {
          if (was.get(book.id) === 'processing' && book.status === 'ready') {
            setArrived((prev) => new Set(prev).add(book.id));
            toast({ kind: 'success', message: `${book.title} is ready on your shelf.`, action: { label: 'Begin reading', onClick: () => navigate(`/read/${book.id}`) } });
          }
        }
        setBooks(data);
        const processing = data.filter((b) => b.status === 'processing');
        const answers = await Promise.allSettled(processing.map((b) => fetchApi(`/books/${b.id}/status`)));
        setIngest((prev) => {
          const next = { ...prev };
          answers.forEach((a, i) => {
            const progress = a.status === 'fulfilled' ? a.value?.ingestion?.progress : null;
            if (typeof progress === 'number') next[processing[i].id] = Math.round(progress * 100);
          });
          return next;
        });
      } catch {
        // ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [books, toast, navigate]);

  // A file dropped anywhere in the window is offered for upload; while one is dragged over, the page says so.
  const selectFile = useRef(null);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e) => { if (hasFiles(e)) { depth += 1; setDragging(true); } };
    const leave = (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDragging(false); } };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer.files.length > 0) selectFile.current?.(e.dataTransfer.files[0]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  };

  const handleFileSelection = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      toast({ kind: 'warning', message: `${file.name} isn’t a PDF, EPUB, Markdown file or notebook, so it can’t go on the shelf.` });
      return;
    }
    setSelectedFile(file);
    // Pre-fill title from filename
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    // Clean up underscores and dashes for default title
    const cleanTitle = nameWithoutExt.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    setUploadTitle(cleanTitle);
    setUploadAuthor('');
    setUploadErrors({});
    setDeviceOnly(false);
    setUploadModalOpen(true);
    // Reset file input so same file can be selected again if cancelled
    if (fileInputRef.current) fileInputRef.current.value = null;
  };

  useEffect(() => { selectFile.current = handleFileSelection; });

  const submitUpload = async (event) => {
    event.preventDefault();
    const errors = {};
    if (!uploadTitle.trim()) errors.title = 'Enter the book’s title.';
    if (!uploadAuthor.trim()) errors.author = 'Enter the author’s name.';
    setUploadErrors(errors);
    if (errors.title || errors.author) {
      event.currentTarget.querySelector(errors.title ? '[name="title"]' : '[name="author"]')?.focus();
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('title', uploadTitle.trim());
    formData.append('author', uploadAuthor.trim());
    const keepHere = deviceOnly && !converting; // a converted book is kept on the server (C19.2c)
    formData.append('storage_mode', keepHere ? 'device' : 'cloud');

    try {
      const resp = await fetchApi('/books/upload', {
        method: 'POST',
        body: formData
      });

      // Optimistically add to state
      const optimbook = {
        id: resp.book_id,
        title: uploadTitle.trim(),
        author: uploadAuthor.trim(),
        status: 'processing',
        file_type: converting ? 'epub' : selectedFile.name.split('.').pop().toLowerCase(),
        storage_mode: keepHere ? 'device' : 'cloud',
      };
      // A device-only book's original exists nowhere else, so it is kept in this browser (C17.1).
      if (keepHere && !(await saveBookFile(resp.book_id, selectedFile))) {
        toast({ kind: 'warning', message: 'This browser couldn’t keep the file. Add it again before you read.' });
      }
      setBooks(prev => [optimbook, ...prev]);
      setUploadModalOpen(false);
      toast({ kind: 'success', message: `${optimbook.title} is on your shelf. We’re reading its pages now.` });
      if (resp.notes?.length) toast({ kind: 'warning', message: missingImages(resp.notes) });
    } catch (err) {
      toast({ kind: 'warning', message: `We couldn’t add that book: ${err.message || 'the upload failed'}.` });
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) return <ShelfSkeleton />;

  const pickFile = () => fileInputRef.current?.click();
  const next = nextBook(books);
  const count = `${books.length} ${books.length === 1 ? 'book' : 'books'}`;

  return (
    <div className="rf-library">
      {dragging && (
        <div className="rf-library__drop" aria-hidden="true">
          <Upload size={28} strokeWidth={1.75} />
          <p>Release to add your book</p>
          <span>PDF or EPUB</span>
        </div>
      )}
      <header className="rf-library__header">
        <h1 className="rf-library__title">Your shelf</h1>
        {books.length > 0 && (
          <p className="rf-library__count">
            {count}{next?.progress ? ` · ${next.title} is where you left off` : ''}
          </p>
        )}
      </header>

      {error && (
        <div className="rf-library__error" role="alert">
          <p>{error} Your books are safe; try again in a moment.</p>
          <Button variant="secondary" onClick={retry}>Try again</Button>
        </div>
      )}

      {!error && books.length === 0 && (
        <EmptyState
          className="rf-library__empty"
          illustration={<EmptyShelf size={240} />}
          title="Your shelf is waiting"
          action={(
            <div className="rf-library__empty-action">
              <Button onClick={pickFile}><Upload size={18} strokeWidth={1.75} aria-hidden="true" />Add a PDF or EPUB</Button>
              <span>or drop a file anywhere on this page</span>
            </div>
          )}
        >
          Add a book you mean to read properly. We’ll pace it into short evening sessions, ask a few questions after each, and keep track of the ideas that need another look.
        </EmptyState>
      )}

      {next && (
        <section className="rf-today" aria-labelledby="rf-today-title">
          <OpenBook size={96} className="rf-today__art" />
          <div className="rf-today__text">
            <p className="eyebrow">{next.progress ? 'Continue reading' : 'Start here'}</p>
            <h2 id="rf-today-title" className="rf-today__title">{next.title}</h2>
            <p className="rf-today__line">
              {next.progress ? `${readPct(next)}% read so far. Today’s pages are planned when you open it.` : `By ${next.author}. Your first session is ready when you are.`}
            </p>
          </div>
          <Link to={`/read/${next.id}`} className="rf-btn rf-btn--primary rf-today__go">
            <span>Begin reading</span>
            <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </section>
      )}

      {books.length > 0 && (
        <section className="rf-shelf-section" aria-labelledby="rf-shelf-title">
          <div className="rf-shelf-section__head">
            <h2 id="rf-shelf-title" className="eyebrow">On your shelf</h2>
            <Button variant="secondary" onClick={pickFile}><Upload size={18} strokeWidth={1.75} aria-hidden="true" />Add a book</Button>
          </div>
          {/* The routes' AnimatePresence starts with initial={false}; this one lets the shelf
              stagger in on a first load. A book that turns ready remounts under a new key and
              plays shelfArrive (moment 1). Under reduced motion both only fade. */}
          <AnimatePresence>
          <m.ul key="shelf" className="rf-shelf" variants={stagger()} initial="hidden" animate="visible">
            {books.map((book, i) => {
              const ready = book.status === 'ready';
              const face = (
                <>
                  <BookCover title={book.title} author={book.author} coverUrl={book.cover_url} processing={book.status === 'processing'} progress={ingest[book.id]} decorative priority={i < 5} />
                  <span className="rf-shelf__title">{book.title}</span>
                  <span className="rf-shelf__author">{book.author}</span>
                </>
              );
              return (
                <m.li
                  key={arrived.has(book.id) ? `${book.id}-ready` : book.id}
                  className="rf-shelf__item"
                  variants={reduced ? fadeIn : arrived.has(book.id) ? shelfArrive : rise}
                  initial={arrived.has(book.id) ? 'hidden' : undefined}
                  animate={arrived.has(book.id) ? 'visible' : undefined}
                >
                  {ready ? <Link to={`/read/${book.id}`} className="rf-shelf__book">{face}</Link> : <div className="rf-shelf__book">{face}</div>}
                  <MasteryBar value={readPct(book)} className="rf-shelf__bar" />
                  <div className="rf-shelf__foot">
                    <p className={`rf-shelf__caption${book.status === 'error' ? ' is-error' : ''}`} aria-live={book.status === 'processing' ? 'polite' : undefined}>{caption(book, ingest[book.id])}</p>
                    <button type="button" className="rf-shelf__remove" onClick={() => setRemoving(book)} aria-label={`Remove ${book.title} from your shelf`}>
                      <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                  {book.storage_mode === 'device' && <p className="rf-shelf__caption rf-shelf__device">This book is only on this device</p>}
                </m.li>
              );
            })}
          </m.ul>
          </AnimatePresence>
        </section>
      )}

      <input type="file" ref={fileInputRef} hidden accept={ACCEPTED.map((ext) => `.${ext}`).join(',')} onChange={handleFileChange} />

      <Modal isOpen={uploadModalOpen} onClose={() => !isUploading && setUploadModalOpen(false)} title="Add to your shelf">
        <form className="rf-library__form" onSubmit={submitUpload} noValidate>
          <p className="rf-library__file">{selectedFile?.name}</p>
          <TextInput label="Title" name="title" value={uploadTitle} error={uploadErrors.title} onChange={(e) => setUploadTitle(e.target.value)} />
          <TextInput label="Author" name="author" value={uploadAuthor} error={uploadErrors.author} onChange={(e) => setUploadAuthor(e.target.value)} />
          {converting ? (
            <p className="rf-library__convert">
              We’ll turn it into a book on our server, keeping its equations, code and images, and store that book for you.
            </p>
          ) : (
            <label className="rf-library__keep">
              <input type="checkbox" name="device_only" checked={deviceOnly} onChange={(e) => setDeviceOnly(e.target.checked)} />
              <span>
                Keep the file on this device only
                <small>We read it once to plan your sessions and don’t store it. You can open it only in this browser.</small>
              </span>
            </label>
          )}
          <div className="rf-library__form-actions">
            <Button variant="secondary" onClick={() => setUploadModalOpen(false)} disabled={isUploading}>Cancel</Button>
            <Button type="submit" loading={isUploading} loadingLabel={converting ? 'Converting…' : 'Uploading…'}>Add book</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={removing !== null} onClose={() => !isRemoving && setRemoving(null)} title={removing ? `Remove ${removing.title}?` : ''}>
        <p className="rf-library__confirm">Its sessions, test results and reading progress go with it. This can’t be undone.</p>
        <div className="rf-library__form-actions">
          <Button variant="secondary" onClick={() => setRemoving(null)} disabled={isRemoving}>Keep it</Button>
          <Button variant="danger" onClick={confirmRemove} loading={isRemoving} loadingLabel="Removing…">Remove</Button>
        </div>
      </Modal>
    </div>
  );
}
