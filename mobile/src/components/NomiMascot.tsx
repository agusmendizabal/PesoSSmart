import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

export type NomiPose = 'alerta' | 'stop' | 'celebra';

const POSES: Record<NomiPose, any> = {
  alerta:  require('../../assets/mascot/nomi-alerta.png'),
  stop:    require('../../assets/mascot/nomi-stop.png'),
  celebra: require('../../assets/mascot/nomi-celebra.png'),
};

interface Props {
  pose: NomiPose;
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export function NomiMascot({ pose, size = 56, style }: Props) {
  return (
    <Image
      source={POSES[pose]}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
    />
  );
}
