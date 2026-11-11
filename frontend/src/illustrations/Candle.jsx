import svg from './svg/Candle.svg?raw';
import { Illustration } from './Illustration';

// A candle in a holder (the dashboard's reading streak). Parts: flame, glow.
export function Candle(props) {
  return <Illustration svg={svg} {...props} />;
}
