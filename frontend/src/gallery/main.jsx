import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './gallery.css';
import { MotionRoot } from '../motion/MotionRoot';
import { Gallery } from './Gallery';
import { ToastProvider } from '../components/ui/Toast';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionRoot>
      <ToastProvider>
        <Gallery />
      </ToastProvider>
    </MotionRoot>
  </StrictMode>,
);
