import svg from './svg/OpenBook.svg?raw';
import { Illustration } from './Illustration';

// Open book with a ribbon bookmark (today's reading card). Part: ribbon.
export function OpenBook(props) {
  return <Illustration svg={svg} {...props} />;
}
