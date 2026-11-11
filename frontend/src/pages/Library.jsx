import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Trash2, Upload } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { MasteryBar } from '../components/ui/MasteryBar';
import { BookCover } from '../components/BookCover';
import { EmptyShelf, OpenBook } from '../illustrations';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './Library.css';

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

function caption(book) {
  if (book.status === 'error') return 'We couldn’t read this file';
  if (book.status !== 'ready') return 'Reading the pages…';
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

  // Upload state
  const fileInputRef = useRef(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
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

  const handleDeleteBook = async (bookId) => {
    if (!window.confirm("Are you sure you want to delete this book from your library?")) return;

    try {
      await fetchApi(`/books/${bookId}`, { method: 'DELETE' });
      setBooks(prev => prev.filter(b => b.id !== bookId));
    } catch (err) {
      alert("Failed to delete book: " + err.message);
    }
  };

  // Polling logic for processing books
  useEffect(() => {
    const hasProcessing = books.some(b => b.status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(async () => {
      // Just reload all books to get updated statuses
      try {
        const data = await fetchApi('/books');
        setBooks(data);
      } catch {
        // ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [books]);

  // A file dropped anywhere on the page is offered for upload.
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  };

  const handleFileSelection = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'pdf' && ext !== 'epub') {
      alert('Only .pdf and .epub files are supported.');
      return;
    }
    setSelectedFile(file);
    // Pre-fill title from filename
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    // Clean up underscores and dashes for default title
    const cleanTitle = nameWithoutExt.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    setUploadTitle(cleanTitle);
    setUploadAuthor('');
    setUploadModalOpen(true);
    // Reset file input so same file can be selected again if cancelled
    if (fileInputRef.current) fileInputRef.current.value = null;
  };

  const submitUpload = async () => {
    if (!uploadTitle.trim() || !uploadAuthor.trim()) {
      alert('Please provide both title and author.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('title', uploadTitle.trim());
    formData.append('author', uploadAuthor.trim());

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
        file_type: selectedFile.name.split('.').pop().toLowerCase(),
      };
      setBooks(prev => [optimbook, ...prev]);
      setUploadModalOpen(false);
    } catch (err) {
      alert(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) return <ShelfSkeleton />;

  const pickFile = () => fileInputRef.current?.click();
  const next = nextBook(books);
  const count = `${books.length} ${books.length === 1 ? 'book' : 'books'}`;

  return (
    <div className="rf-library" onDragOver={handleDragOver} onDrop={handleDrop}>
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
          <ul className="rf-shelf">
            {books.map((book, i) => {
              const ready = book.status === 'ready';
              const face = (
                <>
                  <BookCover title={book.title} author={book.author} coverUrl={book.cover_url} processing={book.status === 'processing'} decorative priority={i < 5} />
                  <span className="rf-shelf__title">{book.title}</span>
                  <span className="rf-shelf__author">{book.author}</span>
                </>
              );
              return (
                <li key={book.id} className="rf-shelf__item">
                  {ready ? <Link to={`/read/${book.id}`} className="rf-shelf__book">{face}</Link> : <div className="rf-shelf__book">{face}</div>}
                  <MasteryBar value={readPct(book)} className="rf-shelf__bar" />
                  <div className="rf-shelf__foot">
                    <p className={`rf-shelf__caption${book.status === 'error' ? ' is-error' : ''}`}>{caption(book)}</p>
                    <button type="button" className="rf-shelf__remove" onClick={() => handleDeleteBook(book.id)} aria-label={`Remove ${book.title} from your shelf`}>
                      <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <input type="file" ref={fileInputRef} hidden accept=".pdf,.epub" onChange={handleFileChange} />

      <Modal isOpen={uploadModalOpen} onClose={() => !isUploading && setUploadModalOpen(false)}>
        <div style={{ padding: '24px', maxWidth: '440px', boxSizing: 'border-box' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', color: 'var(--ink)', marginBottom: '24px' }}>
            Add to your library
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ fontFamily: 'var(--font-ui)', fontWeight: '500', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-light)', marginBottom: '6px' }}>Title</label>
              <input
                type="text"
                value={uploadTitle}
                onChange={e => setUploadTitle(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--paper-dark)', border: '1px solid var(--paper-mid)', borderRadius: '4px', fontFamily: 'var(--font-ui)', fontWeight: '300', fontSize: '15px', color: 'var(--ink)', outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ fontFamily: 'var(--font-ui)', fontWeight: '500', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-light)', marginBottom: '6px' }}>Author</label>
              <input
                type="text"
                value={uploadAuthor}
                onChange={e => setUploadAuthor(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--paper-dark)', border: '1px solid var(--paper-mid)', borderRadius: '4px', fontFamily: 'var(--font-ui)', fontWeight: '300', fontSize: '15px', color: 'var(--ink)', outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              <Button variant="secondary" onClick={() => setUploadModalOpen(false)} disabled={isUploading}>Cancel</Button>
              <Button variant="primary" onClick={submitUpload} loading={isUploading}>Add book</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
