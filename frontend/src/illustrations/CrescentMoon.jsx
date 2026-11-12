import svg from './svg/CrescentMoon.svg?raw';
import { Illustration } from './Illustration';

// Crescent moon with three stars (Lamplight, evening copy). Part: stars.
export function CrescentMoon(props) {
  return <Illustration svg={svg} {...props} />;
}
