export type CategoryIconKey =
  | 'alimentacion' | 'restaurantes' | 'supermercado' | 'cafe-bebidas'
  | 'transporte' | 'combustible' | 'salud' | 'deportes'
  | 'educacion' | 'entretenimiento' | 'ocio-salidas' | 'suscripciones'
  | 'ropa-moda' | 'hogar' | 'servicios' | 'bancos-finanzas'
  | 'viajes' | 'alojamiento' | 'peajes' | 'impuestos'
  | 'regalos' | 'cuidado-personal' | 'seguros' | 'otros';

export function resolveCategoryIcon(categoryName: string, description?: string): CategoryIconKey {
  const n = (categoryName + ' ' + (description ?? '')).toLowerCase();

  if (n.includes('cafe') || n.includes('café') || n.includes('starbucks') || n.includes('bebida') || n.includes('jugo') || n.includes('te ')) return 'cafe-bebidas';
  if (n.includes('restaurant') || n.includes('comida') || n.includes('almuerzo') || n.includes('cena') || n.includes('pizza') || n.includes('sushi') || n.includes('hambur') || n.includes('burger') || n.includes('mcdonald') || n.includes('delivery') || n.includes('pedidos ya') || n.includes('rappi')) return 'restaurantes';
  if (n.includes('supermercado') || n.includes('carrefour') || n.includes('coto') || n.includes('disco') || n.includes('jumbo') || n.includes('walmart') || n.includes('verduleria') || n.includes('almacen') || n.includes('mercado')) return 'supermercado';
  if (n.includes('alimentacion') || n.includes('aliment')) return 'alimentacion';
  if (n.includes('combustible') || n.includes('nafta') || n.includes('gasoil') || n.includes('ypf') || n.includes('shell') || n.includes('axion')) return 'combustible';
  if (n.includes('transporte') || n.includes('uber') || n.includes('taxi') || n.includes('remis') || n.includes('subte') || n.includes('colect') || n.includes('tren') || n.includes('cabify')) return 'transporte';
  if (n.includes('salud') || n.includes('medico') || n.includes('médico') || n.includes('doctor') || n.includes('clinica') || n.includes('hospital') || n.includes('prepaga') || n.includes('farmacia') || n.includes('farma')) return 'salud';
  if (n.includes('deporte') || n.includes('gym') || n.includes('fitness') || n.includes('pilates') || n.includes('natacion') || n.includes('cancha')) return 'deportes';
  if (n.includes('educacion') || n.includes('educación') || n.includes('curso') || n.includes('universidad') || n.includes('colegio') || n.includes('escuela') || n.includes('libro')) return 'educacion';
  if (n.includes('spotify') || n.includes('suscripcion') || n.includes('suscripción') || n.includes('abono') || n.includes('membresia') || n.includes('netflix') || n.includes('disney') || n.includes('hbo') || n.includes('streaming') || n.includes('amazon prime')) return 'suscripciones';
  if (n.includes('ocio') || n.includes('salida') || n.includes('bar') || n.includes('boliche') || n.includes('disco') || n.includes('recital') || n.includes('fiesta')) return 'ocio-salidas';
  if (n.includes('entretenimiento') || n.includes('cine') || n.includes('teatro') || n.includes('juego')) return 'entretenimiento';
  if (n.includes('ropa') || n.includes('calzado') || n.includes('zapato') || n.includes('zapatilla') || n.includes('indumentaria') || n.includes('moda') || n.includes('zara') || n.includes('bonprix')) return 'ropa-moda';
  if (n.includes('hogar') || n.includes('mueble') || n.includes('decoracion') || n.includes('ikea') || n.includes('easy') || n.includes('sodimac')) return 'hogar';
  if (n.includes('servicios') || n.includes('luz') || n.includes('gas') || n.includes('agua') || n.includes('edesur') || n.includes('edenor') || n.includes('metrogas')) return 'servicios';
  if (n.includes('banco') || n.includes('tarjeta') || n.includes('prestamo') || n.includes('cuota') || n.includes('finanzas') || n.includes('mercado pago') || n.includes('naranja') || n.includes('brubank') || n.includes('lemon')) return 'bancos-finanzas';
  if (n.includes('viaje') || n.includes('vuelo') || n.includes('aerolinea') || n.includes('turismo')) return 'viajes';
  if (n.includes('hotel') || n.includes('airbnb') || n.includes('alojamiento') || n.includes('hostel')) return 'alojamiento';
  if (n.includes('peaje') || n.includes('estacionamiento') || n.includes('parking') || n.includes('garage')) return 'peajes';
  if (n.includes('impuesto') || n.includes('afip') || n.includes('arba') || n.includes('municipal')) return 'impuestos';
  if (n.includes('regalo') || n.includes('cumple') || n.includes('obsequio')) return 'regalos';
  if (n.includes('peluqueria') || n.includes('peluquería') || n.includes('estetica') || n.includes('spa') || n.includes('belleza') || n.includes('cuidado')) return 'cuidado-personal';
  if (n.includes('seguro') || n.includes('poliza') || n.includes('póliza') || n.includes('cobertura')) return 'seguros';

  return 'otros';
}
