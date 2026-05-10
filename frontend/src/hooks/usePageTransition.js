import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function usePageTransition() {
  const navigate = useNavigate();

  useEffect(() => {
    // Apply .visible after a tiny delay on mount
    const timer = setTimeout(() => {
      const page = document.querySelector('.page');
      if (page) {
        page.classList.add('visible');
      }
    }, 16);

    return () => clearTimeout(timer);
  }, []);

  const navigateTo = (path) => {
    const page = document.querySelector('.page');
    if (page) {
      page.classList.remove('visible');
      // Wait for 150ms transition (120ms fade out as requested + buffer)
      setTimeout(() => {
        navigate(path);
      }, 150);
    } else {
      navigate(path);
    }
  };

  return navigateTo;
}
