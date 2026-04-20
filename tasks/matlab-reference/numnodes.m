% numnodes.m — MATLAB reference fixture for US-Q01 (numnodes).
%
% Run this script inside MATLAB (R2020a or later). It builds a simple
% 3-node cyclic digraph, calls numnodes, and emits the result as
% tasks/matlab-reference/numnodes.json. The Octave-side test in
% scripts/graph/numnodes.m consumes the JSON via __matlab_ref__.

s = [1 2 3];
t = [2 3 1];
G = digraph(s, t);

result = struct( ...
    'method',   'numnodes', ...
    'input',    struct('s', s, 't', t), ...
    'expected', numnodes(G));

here = fileparts(mfilename('fullpath'));
fid = fopen(fullfile(here, 'numnodes.json'), 'w');
fwrite(fid, jsonencode(result, 'PrettyPrint', true));
fclose(fid);

disp('numnodes.json written.');
