import svg from './svg/ReadingLamp.svg?raw';
import { Illustration } from './Illustration';

// Reading lamp with glow disc and light cone (warming up, dashboard). Parts: glow, cone, bulb.
export function ReadingLamp(props) {
  return <Illustration svg={svg} {...props} />;
}
