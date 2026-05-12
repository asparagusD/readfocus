import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { UploadCloud, ArrowRight, Trash2 } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { ScoreBadge } from '../components/ui/ScoreBadge';
import { usePageTransition } from '../hooks/usePageTransition';
import './Library.css';

export function Library() {
  usePageTransition();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Upload state
  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
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
      setError('Failed to load library');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

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
      } catch (err) {
        // ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [books]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
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

  return (
    <div className="rf-library page">
      <header className="rf-library-header">
        <h1 className="rf-library-title">Your Library</h1>
        <p className="rf-library-subtitle">Upload a book to begin, or continue where you left off.</p>
      </header>

      <div 
        className={`rf-upload-zone ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <UploadCloud size={20} color="var(--ink-faint)" strokeWidth={1.5} />
        <p className="rf-upload-text">Drop a PDF or EPUB here</p>
        <button className="rf-upload-btn" onClick={() => fileInputRef.current?.click()}>
          or click to browse
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept=".pdf,.epub"
          onChange={handleFileChange}
        />
      </div>

      <div className="rf-books-list">
        {!loading && books.length === 0 ? (
          <div className="rf-empty-state">
            <h2>Your library is empty.</h2>
            <p>Upload your first book above to get started.</p>
          </div>
        ) : (
          books.map(book => (
            <div key={book.id} className="rf-book-card">
              <div className={`rf-card-bar ${book.status === 'processing' ? '' : 'started'}`}></div>
              <div className="rf-card-middle">
                {book.status === 'processing' ? (
                  <>
                    <Skeleton className="rf-processing-skeleton" />
                    <div className="rf-card-meta">
                      Processing upload…
                    </div>
                  </>
                ) : book.status === 'error' ? (
                  <>
                    <div className="rf-card-title">{book.title}</div>
                    <div className="rf-card-meta" style={{color: 'var(--red-mid)'}}>
                      Upload failed due to processing error.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rf-card-title">{book.title}</div>
                    <div className="rf-card-meta">
                      {book.author} <span className="rf-dot">·</span> <span className="rf-ext">{book.file_type}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="rf-card-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {book.status === 'processing' ? (
                    <span className="rf-processing-text">Analysing book…</span>
                  ) : book.status === 'error' ? (
                    <span className="rf-processing-text" style={{color: 'var(--red-mid)'}}>Upload failed</span>
                  ) : (
                    <>
                      {/* Placeholder for progress/score if available in the future. For now, we mock the display */}
                      <span className="rf-progress-text">Ch. 1 of {book.total_chunks || '?'}</span>
                      <Link to={`/read/${book.id}`} className="rf-action-link">
                        Continue <ArrowRight size={14} className="rf-arrow" />
                      </Link>
                    </>
                  )}
                </div>
                <button 
                  onClick={() => handleDeleteBook(book.id)} 
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--ink-light)', display: 'flex' }}
                  title="Delete Book"
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--red-mid)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ink-light)'}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal isOpen={uploadModalOpen} onClose={() => !isUploading && setUploadModalOpen(false)}>
        <div style={{ padding: '24px', width: '440px', boxSizing: 'border-box' }}>
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
