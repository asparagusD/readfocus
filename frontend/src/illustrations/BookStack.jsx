import svg from './svg/BookStack.svg?raw';
import { Illustration } from './Illustration';

// Stack of four books (sign-in scene).
export function BookStack(props) {
  return <Illustration svg={svg} {...props} />;
}
