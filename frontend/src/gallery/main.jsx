import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './gallery.css';
import { MotionRoot } from '../motion/MotionRoot';
import { Gallery } from './Gallery';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionRoot>
      <Gallery />
    </MotionRoot>
  </StrictMode>,
);
