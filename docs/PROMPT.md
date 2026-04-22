Utilise le skill /emil-design-eng pour orchestrer les animations d'entrée et de sortie de tous les composants d'interface (overlays, volets, menus, modales).



Timing \& Rythme :



Les animations doivent être "snappy" (réactives). Vise une durée de 200ms à 300ms.



Utilise une courbe de bézier de type cubic-bezier(0.34, 1.56, 0.64, 1) pour l'entrée (effet de rebond très léger et pro) et une sortie plus directe en cubic-bezier(0.32, 0, 0.67, 0).



Chorégraphie :



Ne te contente pas d'un simple fondu. Combine "Opacity", "Scale" (de 0.95 à 1) et "TranslateY" (de 20px à 0) pour les modales.



Pour les volets latéraux (drawers), utilise une translation latérale propre avec un léger effet de flou sur le contenu en arrière-plan (backdrop-filter: blur(4px)).



Implémente un "Staggering" (décalage) de 0.05s pour les éléments internes d'un composant qui s'ouvre.



Robustesse technique :



Assure-toi que les animations utilisent "will-change" pour garantir la fluidité sur mobile.



Gère correctement la suppression des éléments du DOM seulement après la fin de l'animation de sortie.



Ajoute une condition pour respecter les préférences système "prefers-reduced-motion".

