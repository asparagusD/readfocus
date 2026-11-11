import svg from './svg/EmptyShelf.svg?raw';
import { Illustration } from './Illustration';

// Empty bookcase with a bookend and one leaning book (empty library).
export function EmptyShelf(props) {
  return <Illustration svg={svg} {...props} />;
}
