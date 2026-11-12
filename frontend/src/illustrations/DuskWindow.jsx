import svg from './svg/DuskWindow.svg?raw';
import { Illustration } from './Illustration';

// Arched window at dusk, low sun over a hill (sign-in scene). Parts: sun, hill.
export function DuskWindow(props) {
  return <Illustration svg={svg} {...props} />;
}
