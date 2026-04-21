
rm_sources =      [0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8]
rm_destinations = [1, 2, 1, 3, 4, 5, 8, 6, 7, 8, 6, 3]
rm_weights = [1,1,1,1,1,1,1,1,1,1,1,1]
rm_names = {'0' '1' '2' '3' '4' '5' '6' '7' '8'}

rm_sources = rm_sources + 1;
rm_destinations = rm_destinations + 1;

G = digraph(rm_sources, rm_destinations, rm_weights, rm_names)

plot(G)
