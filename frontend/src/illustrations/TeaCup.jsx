import svg from './svg/TeaCup.svg?raw';
import { Illustration } from './Illustration';

// Tea cup on a saucer line (warming up). `steam={false}` gives the error
// screen's empty, cooled cup. Part: steam (three separate wisps).
export function TeaCup({ steam = true, ...props }) {
  return <Illustration svg={svg} data-steam={steam ? undefined : 'off'} {...props} />;
}
