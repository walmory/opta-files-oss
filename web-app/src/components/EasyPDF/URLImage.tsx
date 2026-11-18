import { Image as KonvaImage } from 'react-konva';
import useImage from 'use-image';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const URLImage = ({ src, width, height, ...props }: any) => {
  const [image] = useImage(src, 'anonymous');
  return <KonvaImage image={image} width={width} height={height} {...props} />;
};

export default URLImage;
