import type { languages, editor, Position, CancellationToken } from 'monaco-editor'

// Comprehensive list of Octave/MATLAB built-in functions with signatures
interface BuiltinFunction {
  name: string
  signature: string
  description: string
  category: string
}

const OCTAVE_BUILTINS: BuiltinFunction[] = [
  // Math - Elementary
  { name: 'abs', signature: 'abs(X)', description: 'Absolute value or complex magnitude', category: 'Math' },
  { name: 'sign', signature: 'sign(X)', description: 'Signum function', category: 'Math' },
  { name: 'round', signature: 'round(X)', description: 'Round to nearest integer', category: 'Math' },
  { name: 'floor', signature: 'floor(X)', description: 'Round toward negative infinity', category: 'Math' },
  { name: 'ceil', signature: 'ceil(X)', description: 'Round toward positive infinity', category: 'Math' },
  { name: 'fix', signature: 'fix(X)', description: 'Round toward zero', category: 'Math' },
  { name: 'mod', signature: 'mod(X, Y)', description: 'Modulus after division', category: 'Math' },
  { name: 'rem', signature: 'rem(X, Y)', description: 'Remainder after division', category: 'Math' },
  { name: 'sqrt', signature: 'sqrt(X)', description: 'Square root', category: 'Math' },
  { name: 'cbrt', signature: 'cbrt(X)', description: 'Cube root', category: 'Math' },
  { name: 'pow2', signature: 'pow2(X)', description: 'Power of 2', category: 'Math' },
  { name: 'exp', signature: 'exp(X)', description: 'Exponential (e^X)', category: 'Math' },
  { name: 'expm1', signature: 'expm1(X)', description: 'Compute exp(X)-1 accurately for small X', category: 'Math' },
  { name: 'log', signature: 'log(X)', description: 'Natural logarithm', category: 'Math' },
  { name: 'log2', signature: 'log2(X)', description: 'Base-2 logarithm', category: 'Math' },
  { name: 'log10', signature: 'log10(X)', description: 'Base-10 logarithm', category: 'Math' },
  { name: 'log1p', signature: 'log1p(X)', description: 'Compute log(1+X) accurately for small X', category: 'Math' },
  { name: 'real', signature: 'real(Z)', description: 'Real part of complex number', category: 'Math' },
  { name: 'imag', signature: 'imag(Z)', description: 'Imaginary part of complex number', category: 'Math' },
  { name: 'conj', signature: 'conj(Z)', description: 'Complex conjugate', category: 'Math' },
  { name: 'complex', signature: 'complex(A, B)', description: 'Create complex number', category: 'Math' },
  { name: 'angle', signature: 'angle(Z)', description: 'Phase angle of complex number', category: 'Math' },
  { name: 'factorial', signature: 'factorial(N)', description: 'Factorial of N', category: 'Math' },
  { name: 'gcd', signature: 'gcd(A, B)', description: 'Greatest common divisor', category: 'Math' },
  { name: 'lcm', signature: 'lcm(A, B)', description: 'Least common multiple', category: 'Math' },

  // Trigonometry
  { name: 'sin', signature: 'sin(X)', description: 'Sine (radians)', category: 'Trig' },
  { name: 'cos', signature: 'cos(X)', description: 'Cosine (radians)', category: 'Trig' },
  { name: 'tan', signature: 'tan(X)', description: 'Tangent (radians)', category: 'Trig' },
  { name: 'asin', signature: 'asin(X)', description: 'Inverse sine', category: 'Trig' },
  { name: 'acos', signature: 'acos(X)', description: 'Inverse cosine', category: 'Trig' },
  { name: 'atan', signature: 'atan(X)', description: 'Inverse tangent', category: 'Trig' },
  { name: 'atan2', signature: 'atan2(Y, X)', description: 'Four-quadrant inverse tangent', category: 'Trig' },
  { name: 'sinh', signature: 'sinh(X)', description: 'Hyperbolic sine', category: 'Trig' },
  { name: 'cosh', signature: 'cosh(X)', description: 'Hyperbolic cosine', category: 'Trig' },
  { name: 'tanh', signature: 'tanh(X)', description: 'Hyperbolic tangent', category: 'Trig' },
  { name: 'asinh', signature: 'asinh(X)', description: 'Inverse hyperbolic sine', category: 'Trig' },
  { name: 'acosh', signature: 'acosh(X)', description: 'Inverse hyperbolic cosine', category: 'Trig' },
  { name: 'atanh', signature: 'atanh(X)', description: 'Inverse hyperbolic tangent', category: 'Trig' },
  { name: 'sind', signature: 'sind(X)', description: 'Sine (degrees)', category: 'Trig' },
  { name: 'cosd', signature: 'cosd(X)', description: 'Cosine (degrees)', category: 'Trig' },
  { name: 'tand', signature: 'tand(X)', description: 'Tangent (degrees)', category: 'Trig' },
  { name: 'asind', signature: 'asind(X)', description: 'Inverse sine (degrees)', category: 'Trig' },
  { name: 'acosd', signature: 'acosd(X)', description: 'Inverse cosine (degrees)', category: 'Trig' },
  { name: 'atand', signature: 'atand(X)', description: 'Inverse tangent (degrees)', category: 'Trig' },
  { name: 'sec', signature: 'sec(X)', description: 'Secant', category: 'Trig' },
  { name: 'csc', signature: 'csc(X)', description: 'Cosecant', category: 'Trig' },
  { name: 'cot', signature: 'cot(X)', description: 'Cotangent', category: 'Trig' },
  { name: 'deg2rad', signature: 'deg2rad(D)', description: 'Convert degrees to radians', category: 'Trig' },
  { name: 'rad2deg', signature: 'rad2deg(R)', description: 'Convert radians to degrees', category: 'Trig' },

  // Matrix creation
  { name: 'zeros', signature: 'zeros(M, N)', description: 'Create matrix of all zeros', category: 'Matrix' },
  { name: 'ones', signature: 'ones(M, N)', description: 'Create matrix of all ones', category: 'Matrix' },
  { name: 'eye', signature: 'eye(N)', description: 'Identity matrix', category: 'Matrix' },
  { name: 'rand', signature: 'rand(M, N)', description: 'Uniformly distributed random numbers', category: 'Matrix' },
  { name: 'randn', signature: 'randn(M, N)', description: 'Normally distributed random numbers', category: 'Matrix' },
  { name: 'randi', signature: 'randi(IMAX, M, N)', description: 'Random integers', category: 'Matrix' },
  { name: 'linspace', signature: 'linspace(A, B, N)', description: 'Linearly spaced vector', category: 'Matrix' },
  { name: 'logspace', signature: 'logspace(A, B, N)', description: 'Logarithmically spaced vector', category: 'Matrix' },
  { name: 'diag', signature: 'diag(V, K)', description: 'Create diagonal matrix or extract diagonal', category: 'Matrix' },
  { name: 'blkdiag', signature: 'blkdiag(A, B, ...)', description: 'Block diagonal matrix', category: 'Matrix' },
  { name: 'repmat', signature: 'repmat(A, M, N)', description: 'Replicate and tile matrix', category: 'Matrix' },
  { name: 'meshgrid', signature: '[X, Y] = meshgrid(x, y)', description: 'Create 2-D grid coordinates', category: 'Matrix' },
  { name: 'ndgrid', signature: '[X, Y] = ndgrid(x, y)', description: 'Create N-D grid arrays', category: 'Matrix' },
  { name: 'cat', signature: 'cat(DIM, A, B)', description: 'Concatenate arrays along dimension', category: 'Matrix' },
  { name: 'horzcat', signature: 'horzcat(A, B)', description: 'Horizontal concatenation', category: 'Matrix' },
  { name: 'vertcat', signature: 'vertcat(A, B)', description: 'Vertical concatenation', category: 'Matrix' },
  { name: 'sparse', signature: 'sparse(I, J, V, M, N)', description: 'Create sparse matrix', category: 'Matrix' },
  { name: 'full', signature: 'full(S)', description: 'Convert sparse to full matrix', category: 'Matrix' },
  { name: 'true', signature: 'true(M, N)', description: 'Logical true array', category: 'Matrix' },
  { name: 'false', signature: 'false(M, N)', description: 'Logical false array', category: 'Matrix' },
  { name: 'nan', signature: 'nan(M, N)', description: 'NaN array', category: 'Matrix' },
  { name: 'inf', signature: 'inf(M, N)', description: 'Infinity array', category: 'Matrix' },

  // Matrix operations
  { name: 'size', signature: 'size(A)', description: 'Array dimensions', category: 'Matrix' },
  { name: 'length', signature: 'length(A)', description: 'Length of largest dimension', category: 'Matrix' },
  { name: 'numel', signature: 'numel(A)', description: 'Number of elements', category: 'Matrix' },
  { name: 'ndims', signature: 'ndims(A)', description: 'Number of dimensions', category: 'Matrix' },
  { name: 'reshape', signature: 'reshape(A, M, N)', description: 'Reshape array', category: 'Matrix' },
  { name: 'squeeze', signature: 'squeeze(A)', description: 'Remove singleton dimensions', category: 'Matrix' },
  { name: 'permute', signature: 'permute(A, ORDER)', description: 'Rearrange dimensions', category: 'Matrix' },
  { name: 'transpose', signature: 'transpose(A)', description: 'Transpose matrix', category: 'Matrix' },
  { name: 'ctranspose', signature: 'ctranspose(A)', description: 'Complex conjugate transpose', category: 'Matrix' },
  { name: 'fliplr', signature: 'fliplr(A)', description: 'Flip left-right', category: 'Matrix' },
  { name: 'flipud', signature: 'flipud(A)', description: 'Flip up-down', category: 'Matrix' },
  { name: 'rot90', signature: 'rot90(A, K)', description: 'Rotate matrix 90 degrees', category: 'Matrix' },
  { name: 'sort', signature: 'sort(A)', description: 'Sort array elements', category: 'Matrix' },
  { name: 'sortrows', signature: 'sortrows(A)', description: 'Sort rows of matrix', category: 'Matrix' },
  { name: 'unique', signature: 'unique(A)', description: 'Unique values', category: 'Matrix' },
  { name: 'find', signature: 'find(X)', description: 'Find nonzero elements', category: 'Matrix' },
  { name: 'sub2ind', signature: 'sub2ind(SZ, I, J)', description: 'Subscripts to linear indices', category: 'Matrix' },
  { name: 'ind2sub', signature: '[I, J] = ind2sub(SZ, IND)', description: 'Linear indices to subscripts', category: 'Matrix' },
  { name: 'kron', signature: 'kron(A, B)', description: 'Kronecker product', category: 'Matrix' },
  { name: 'cross', signature: 'cross(A, B)', description: 'Cross product', category: 'Matrix' },
  { name: 'dot', signature: 'dot(A, B)', description: 'Dot product', category: 'Matrix' },
  { name: 'triu', signature: 'triu(A)', description: 'Upper triangular part', category: 'Matrix' },
  { name: 'tril', signature: 'tril(A)', description: 'Lower triangular part', category: 'Matrix' },

  // Linear algebra
  { name: 'inv', signature: 'inv(A)', description: 'Matrix inverse', category: 'Linear Algebra' },
  { name: 'pinv', signature: 'pinv(A)', description: 'Pseudoinverse', category: 'Linear Algebra' },
  { name: 'det', signature: 'det(A)', description: 'Determinant', category: 'Linear Algebra' },
  { name: 'trace', signature: 'trace(A)', description: 'Sum of diagonal elements', category: 'Linear Algebra' },
  { name: 'rank', signature: 'rank(A)', description: 'Matrix rank', category: 'Linear Algebra' },
  { name: 'norm', signature: 'norm(A, P)', description: 'Matrix or vector norm', category: 'Linear Algebra' },
  { name: 'cond', signature: 'cond(A)', description: 'Condition number', category: 'Linear Algebra' },
  { name: 'eig', signature: '[V, D] = eig(A)', description: 'Eigenvalues and eigenvectors', category: 'Linear Algebra' },
  { name: 'eigs', signature: '[V, D] = eigs(A, K)', description: 'Largest eigenvalues', category: 'Linear Algebra' },
  { name: 'svd', signature: '[U, S, V] = svd(A)', description: 'Singular value decomposition', category: 'Linear Algebra' },
  { name: 'lu', signature: '[L, U, P] = lu(A)', description: 'LU factorization', category: 'Linear Algebra' },
  { name: 'qr', signature: '[Q, R] = qr(A)', description: 'QR factorization', category: 'Linear Algebra' },
  { name: 'chol', signature: 'R = chol(A)', description: 'Cholesky factorization', category: 'Linear Algebra' },
  { name: 'schur', signature: '[U, T] = schur(A)', description: 'Schur decomposition', category: 'Linear Algebra' },
  { name: 'null', signature: 'null(A)', description: 'Null space', category: 'Linear Algebra' },
  { name: 'orth', signature: 'orth(A)', description: 'Orthogonal basis for range', category: 'Linear Algebra' },
  { name: 'linsolve', signature: 'linsolve(A, B)', description: 'Solve linear system', category: 'Linear Algebra' },
  { name: 'mldivide', signature: 'mldivide(A, B)', description: 'Solve A\\B', category: 'Linear Algebra' },
  { name: 'mrdivide', signature: 'mrdivide(A, B)', description: 'Solve A/B', category: 'Linear Algebra' },
  { name: 'expm', signature: 'expm(A)', description: 'Matrix exponential', category: 'Linear Algebra' },
  { name: 'logm', signature: 'logm(A)', description: 'Matrix logarithm', category: 'Linear Algebra' },
  { name: 'sqrtm', signature: 'sqrtm(A)', description: 'Matrix square root', category: 'Linear Algebra' },

  // Statistics
  { name: 'sum', signature: 'sum(A, DIM)', description: 'Sum of elements', category: 'Statistics' },
  { name: 'prod', signature: 'prod(A, DIM)', description: 'Product of elements', category: 'Statistics' },
  { name: 'cumsum', signature: 'cumsum(A, DIM)', description: 'Cumulative sum', category: 'Statistics' },
  { name: 'cumprod', signature: 'cumprod(A, DIM)', description: 'Cumulative product', category: 'Statistics' },
  { name: 'mean', signature: 'mean(A, DIM)', description: 'Average or mean value', category: 'Statistics' },
  { name: 'median', signature: 'median(A)', description: 'Median value', category: 'Statistics' },
  { name: 'mode', signature: 'mode(A)', description: 'Most frequent value', category: 'Statistics' },
  { name: 'var', signature: 'var(A)', description: 'Variance', category: 'Statistics' },
  { name: 'std', signature: 'std(A)', description: 'Standard deviation', category: 'Statistics' },
  { name: 'cov', signature: 'cov(X, Y)', description: 'Covariance matrix', category: 'Statistics' },
  { name: 'corrcoef', signature: 'corrcoef(X, Y)', description: 'Correlation coefficients', category: 'Statistics' },
  { name: 'max', signature: 'max(A)', description: 'Maximum value', category: 'Statistics' },
  { name: 'min', signature: 'min(A)', description: 'Minimum value', category: 'Statistics' },
  { name: 'hist', signature: 'hist(Y, NBINS)', description: 'Histogram', category: 'Statistics' },
  { name: 'histc', signature: 'histc(Y, EDGES)', description: 'Histogram count', category: 'Statistics' },
  { name: 'conv', signature: 'conv(A, B)', description: 'Convolution', category: 'Statistics' },
  { name: 'conv2', signature: 'conv2(A, B)', description: '2-D convolution', category: 'Statistics' },
  { name: 'deconv', signature: 'deconv(B, A)', description: 'Deconvolution', category: 'Statistics' },
  { name: 'filter', signature: 'filter(B, A, X)', description: '1-D digital filter', category: 'Statistics' },

  // Plotting
  { name: 'plot', signature: 'plot(X, Y, LineSpec)', description: '2-D line plot', category: 'Plotting' },
  { name: 'plot3', signature: 'plot3(X, Y, Z)', description: '3-D line plot', category: 'Plotting' },
  { name: 'scatter', signature: 'scatter(X, Y, S, C)', description: 'Scatter plot', category: 'Plotting' },
  { name: 'scatter3', signature: 'scatter3(X, Y, Z)', description: '3-D scatter plot', category: 'Plotting' },
  { name: 'bar', signature: 'bar(X, Y)', description: 'Bar graph', category: 'Plotting' },
  { name: 'barh', signature: 'barh(X, Y)', description: 'Horizontal bar graph', category: 'Plotting' },
  { name: 'histogram', signature: 'histogram(X, NBINS)', description: 'Histogram plot', category: 'Plotting' },
  { name: 'pie', signature: 'pie(X)', description: 'Pie chart', category: 'Plotting' },
  { name: 'stem', signature: 'stem(X, Y)', description: 'Stem plot', category: 'Plotting' },
  { name: 'stairs', signature: 'stairs(X, Y)', description: 'Stairstep plot', category: 'Plotting' },
  { name: 'area', signature: 'area(X, Y)', description: 'Area plot', category: 'Plotting' },
  { name: 'errorbar', signature: 'errorbar(X, Y, E)', description: 'Error bar plot', category: 'Plotting' },
  { name: 'polar', signature: 'polar(THETA, RHO)', description: 'Polar plot', category: 'Plotting' },
  { name: 'loglog', signature: 'loglog(X, Y)', description: 'Log-log plot', category: 'Plotting' },
  { name: 'semilogx', signature: 'semilogx(X, Y)', description: 'Semi-log X plot', category: 'Plotting' },
  { name: 'semilogy', signature: 'semilogy(X, Y)', description: 'Semi-log Y plot', category: 'Plotting' },
  { name: 'contour', signature: 'contour(X, Y, Z)', description: 'Contour plot', category: 'Plotting' },
  { name: 'contourf', signature: 'contourf(X, Y, Z)', description: 'Filled contour plot', category: 'Plotting' },
  { name: 'surf', signature: 'surf(X, Y, Z)', description: '3-D surface plot', category: 'Plotting' },
  { name: 'mesh', signature: 'mesh(X, Y, Z)', description: '3-D mesh plot', category: 'Plotting' },
  { name: 'imagesc', signature: 'imagesc(C)', description: 'Display image with scaled colors', category: 'Plotting' },
  { name: 'image', signature: 'image(C)', description: 'Display image', category: 'Plotting' },
  { name: 'pcolor', signature: 'pcolor(X, Y, C)', description: 'Pseudocolor plot', category: 'Plotting' },
  { name: 'quiver', signature: 'quiver(X, Y, U, V)', description: 'Quiver (vector field) plot', category: 'Plotting' },
  { name: 'comet', signature: 'comet(X, Y)', description: 'Animated comet plot', category: 'Plotting' },
  { name: 'subplot', signature: 'subplot(M, N, P)', description: 'Create subplot axes', category: 'Plotting' },
  { name: 'figure', signature: 'figure(N)', description: 'Create or select figure window', category: 'Plotting' },
  { name: 'hold', signature: 'hold on/off', description: 'Hold current plot', category: 'Plotting' },
  { name: 'title', signature: 'title(TXT)', description: 'Add title to axes', category: 'Plotting' },
  { name: 'xlabel', signature: 'xlabel(TXT)', description: 'Label x-axis', category: 'Plotting' },
  { name: 'ylabel', signature: 'ylabel(TXT)', description: 'Label y-axis', category: 'Plotting' },
  { name: 'zlabel', signature: 'zlabel(TXT)', description: 'Label z-axis', category: 'Plotting' },
  { name: 'legend', signature: 'legend(STR1, STR2, ...)', description: 'Add legend to plot', category: 'Plotting' },
  { name: 'grid', signature: 'grid on/off', description: 'Display grid lines', category: 'Plotting' },
  { name: 'axis', signature: 'axis([XMIN XMAX YMIN YMAX])', description: 'Set axis limits', category: 'Plotting' },
  { name: 'xlim', signature: 'xlim([XMIN XMAX])', description: 'Set x-axis limits', category: 'Plotting' },
  { name: 'ylim', signature: 'ylim([YMIN YMAX])', description: 'Set y-axis limits', category: 'Plotting' },
  { name: 'zlim', signature: 'zlim([ZMIN ZMAX])', description: 'Set z-axis limits', category: 'Plotting' },
  { name: 'colorbar', signature: 'colorbar', description: 'Display colorbar', category: 'Plotting' },
  { name: 'colormap', signature: 'colormap(MAP)', description: 'Set colormap', category: 'Plotting' },
  { name: 'caxis', signature: 'caxis([CMIN CMAX])', description: 'Set color axis limits', category: 'Plotting' },
  { name: 'text', signature: 'text(X, Y, TXT)', description: 'Add text to plot', category: 'Plotting' },
  { name: 'annotation', signature: 'annotation(TYPE, POS)', description: 'Add annotation', category: 'Plotting' },
  { name: 'clf', signature: 'clf', description: 'Clear current figure', category: 'Plotting' },
  { name: 'cla', signature: 'cla', description: 'Clear current axes', category: 'Plotting' },
  { name: 'close', signature: 'close(H)', description: 'Close figure', category: 'Plotting' },
  { name: 'saveas', signature: 'saveas(FIG, FILENAME)', description: 'Save figure to file', category: 'Plotting' },
  { name: 'print', signature: 'print(FILENAME, FORMAT)', description: 'Print or save figure', category: 'Plotting' },
  { name: 'gca', signature: 'gca', description: 'Get current axes handle', category: 'Plotting' },
  { name: 'gcf', signature: 'gcf', description: 'Get current figure handle', category: 'Plotting' },
  { name: 'set', signature: 'set(H, PROP, VAL)', description: 'Set graphics object property', category: 'Plotting' },
  { name: 'get', signature: 'get(H, PROP)', description: 'Get graphics object property', category: 'Plotting' },
  { name: 'view', signature: 'view(AZ, EL)', description: 'Set 3-D view angle', category: 'Plotting' },
  { name: 'rotate3d', signature: 'rotate3d on/off', description: 'Enable 3D rotation', category: 'Plotting' },
  { name: 'pan', signature: 'pan on/off', description: 'Enable pan mode', category: 'Plotting' },
  { name: 'zoom', signature: 'zoom on/off', description: 'Enable zoom mode', category: 'Plotting' },
  { name: 'shading', signature: 'shading INTERP/FLAT', description: 'Set shading mode', category: 'Plotting' },
  { name: 'lighting', signature: 'lighting GOURAUD/FLAT', description: 'Set lighting mode', category: 'Plotting' },

  // String functions
  { name: 'sprintf', signature: 'sprintf(FORMAT, A, ...)', description: 'Format string', category: 'String' },
  { name: 'fprintf', signature: 'fprintf(FID, FORMAT, A, ...)', description: 'Write formatted data', category: 'String' },
  { name: 'disp', signature: 'disp(X)', description: 'Display value', category: 'String' },
  { name: 'num2str', signature: 'num2str(A, PRECISION)', description: 'Number to string', category: 'String' },
  { name: 'str2num', signature: 'str2num(S)', description: 'String to number', category: 'String' },
  { name: 'str2double', signature: 'str2double(S)', description: 'String to double', category: 'String' },
  { name: 'int2str', signature: 'int2str(N)', description: 'Integer to string', category: 'String' },
  { name: 'mat2str', signature: 'mat2str(A)', description: 'Matrix to string', category: 'String' },
  { name: 'char', signature: 'char(X)', description: 'Convert to character array', category: 'String' },
  { name: 'double', signature: 'double(X)', description: 'Convert to double precision', category: 'String' },
  { name: 'string', signature: 'string(X)', description: 'Convert to string', category: 'String' },
  { name: 'strcmp', signature: 'strcmp(S1, S2)', description: 'Compare strings', category: 'String' },
  { name: 'strcmpi', signature: 'strcmpi(S1, S2)', description: 'Compare strings (case insensitive)', category: 'String' },
  { name: 'strncmp', signature: 'strncmp(S1, S2, N)', description: 'Compare first N characters', category: 'String' },
  { name: 'strcat', signature: 'strcat(S1, S2, ...)', description: 'Concatenate strings', category: 'String' },
  { name: 'strsplit', signature: 'strsplit(S, DELIM)', description: 'Split string', category: 'String' },
  { name: 'strjoin', signature: 'strjoin(C, DELIM)', description: 'Join strings', category: 'String' },
  { name: 'strtrim', signature: 'strtrim(S)', description: 'Remove leading/trailing whitespace', category: 'String' },
  { name: 'strrep', signature: 'strrep(S, OLD, NEW)', description: 'Replace substring', category: 'String' },
  { name: 'regexpi', signature: 'regexpi(S, EXPR)', description: 'Case-insensitive regex match', category: 'String' },
  { name: 'regexp', signature: 'regexp(S, EXPR)', description: 'Regular expression match', category: 'String' },
  { name: 'regexprep', signature: 'regexprep(S, EXPR, REPLACE)', description: 'Regular expression replace', category: 'String' },
  { name: 'upper', signature: 'upper(S)', description: 'Convert to uppercase', category: 'String' },
  { name: 'lower', signature: 'lower(S)', description: 'Convert to lowercase', category: 'String' },
  { name: 'deblank', signature: 'deblank(S)', description: 'Remove trailing blanks', category: 'String' },
  { name: 'fliplr', signature: 'fliplr(S)', description: 'Reverse string', category: 'String' },
  { name: 'blanks', signature: 'blanks(N)', description: 'String of blanks', category: 'String' },

  // I/O functions
  { name: 'fopen', signature: 'FID = fopen(FILENAME, MODE)', description: 'Open file', category: 'IO' },
  { name: 'fclose', signature: 'fclose(FID)', description: 'Close file', category: 'IO' },
  { name: 'fread', signature: 'fread(FID, SIZE, PRECISION)', description: 'Read binary data', category: 'IO' },
  { name: 'fwrite', signature: 'fwrite(FID, A, PRECISION)', description: 'Write binary data', category: 'IO' },
  { name: 'fgets', signature: 'fgets(FID)', description: 'Read line from file', category: 'IO' },
  { name: 'fgetl', signature: 'fgetl(FID)', description: 'Read line (no newline)', category: 'IO' },
  { name: 'fscanf', signature: 'fscanf(FID, FORMAT)', description: 'Read formatted data', category: 'IO' },
  { name: 'fseek', signature: 'fseek(FID, OFFSET, ORIGIN)', description: 'Set file position', category: 'IO' },
  { name: 'ftell', signature: 'ftell(FID)', description: 'Get file position', category: 'IO' },
  { name: 'feof', signature: 'feof(FID)', description: 'Test for end-of-file', category: 'IO' },
  { name: 'textscan', signature: 'textscan(FID, FORMAT)', description: 'Read formatted text', category: 'IO' },
  { name: 'dlmread', signature: 'dlmread(FILENAME, DELIM)', description: 'Read delimited file', category: 'IO' },
  { name: 'dlmwrite', signature: 'dlmwrite(FILENAME, M, DELIM)', description: 'Write delimited file', category: 'IO' },
  { name: 'csvread', signature: 'csvread(FILENAME)', description: 'Read CSV file', category: 'IO' },
  { name: 'csvwrite', signature: 'csvwrite(FILENAME, M)', description: 'Write CSV file', category: 'IO' },
  { name: 'load', signature: 'load(FILENAME)', description: 'Load variables from file', category: 'IO' },
  { name: 'save', signature: 'save(FILENAME, VAR1, ...)', description: 'Save variables to file', category: 'IO' },
  { name: 'input', signature: 'input(PROMPT)', description: 'Prompt for user input', category: 'IO' },
  { name: 'keyboard', signature: 'keyboard', description: 'Enter debug mode', category: 'IO' },
  { name: 'error', signature: 'error(MSG, ...)', description: 'Display error and stop', category: 'IO' },
  { name: 'warning', signature: 'warning(MSG, ...)', description: 'Display warning', category: 'IO' },
  { name: 'assert', signature: 'assert(COND)', description: 'Assert condition is true', category: 'IO' },

  // Type checking
  { name: 'class', signature: 'class(OBJ)', description: 'Class of object', category: 'Type' },
  { name: 'typecast', signature: 'typecast(X, TYPE)', description: 'Convert without changing bits', category: 'Type' },
  { name: 'cast', signature: 'cast(X, TYPE)', description: 'Cast to different type', category: 'Type' },
  { name: 'isa', signature: 'isa(OBJ, CLASSNAME)', description: 'Test object class', category: 'Type' },
  { name: 'isnumeric', signature: 'isnumeric(A)', description: 'True for numeric arrays', category: 'Type' },
  { name: 'ischar', signature: 'ischar(A)', description: 'True for character arrays', category: 'Type' },
  { name: 'isstring', signature: 'isstring(A)', description: 'True for string arrays', category: 'Type' },
  { name: 'islogical', signature: 'islogical(A)', description: 'True for logical arrays', category: 'Type' },
  { name: 'iscell', signature: 'iscell(A)', description: 'True for cell arrays', category: 'Type' },
  { name: 'isstruct', signature: 'isstruct(A)', description: 'True for struct arrays', category: 'Type' },
  { name: 'isempty', signature: 'isempty(A)', description: 'True for empty arrays', category: 'Type' },
  { name: 'isscalar', signature: 'isscalar(A)', description: 'True for scalar values', category: 'Type' },
  { name: 'isvector', signature: 'isvector(A)', description: 'True for vectors', category: 'Type' },
  { name: 'ismatrix', signature: 'ismatrix(A)', description: 'True for matrices', category: 'Type' },
  { name: 'isnan', signature: 'isnan(A)', description: 'True for NaN elements', category: 'Type' },
  { name: 'isinf', signature: 'isinf(A)', description: 'True for Inf elements', category: 'Type' },
  { name: 'isfinite', signature: 'isfinite(A)', description: 'True for finite elements', category: 'Type' },
  { name: 'isreal', signature: 'isreal(A)', description: 'True for real arrays', category: 'Type' },
  { name: 'isinteger', signature: 'isinteger(A)', description: 'True for integer arrays', category: 'Type' },
  { name: 'isfloat', signature: 'isfloat(A)', description: 'True for floating-point arrays', category: 'Type' },
  { name: 'exist', signature: 'exist(NAME, TYPE)', description: 'Check if name exists', category: 'Type' },

  // Data type conversion
  { name: 'int8', signature: 'int8(X)', description: 'Convert to 8-bit integer', category: 'Type' },
  { name: 'int16', signature: 'int16(X)', description: 'Convert to 16-bit integer', category: 'Type' },
  { name: 'int32', signature: 'int32(X)', description: 'Convert to 32-bit integer', category: 'Type' },
  { name: 'int64', signature: 'int64(X)', description: 'Convert to 64-bit integer', category: 'Type' },
  { name: 'uint8', signature: 'uint8(X)', description: 'Convert to unsigned 8-bit integer', category: 'Type' },
  { name: 'uint16', signature: 'uint16(X)', description: 'Convert to unsigned 16-bit integer', category: 'Type' },
  { name: 'uint32', signature: 'uint32(X)', description: 'Convert to unsigned 32-bit integer', category: 'Type' },
  { name: 'uint64', signature: 'uint64(X)', description: 'Convert to unsigned 64-bit integer', category: 'Type' },
  { name: 'single', signature: 'single(X)', description: 'Convert to single precision', category: 'Type' },
  { name: 'logical', signature: 'logical(X)', description: 'Convert to logical', category: 'Type' },
  { name: 'cell', signature: 'cell(M, N)', description: 'Create cell array', category: 'Type' },
  { name: 'struct', signature: 'struct(FIELD, VALUE, ...)', description: 'Create structure', category: 'Type' },
  { name: 'cell2mat', signature: 'cell2mat(C)', description: 'Convert cell array to matrix', category: 'Type' },
  { name: 'num2cell', signature: 'num2cell(A)', description: 'Convert array to cell array', category: 'Type' },
  { name: 'fieldnames', signature: 'fieldnames(S)', description: 'Field names of structure', category: 'Type' },
  { name: 'rmfield', signature: 'rmfield(S, FIELD)', description: 'Remove structure field', category: 'Type' },
  { name: 'orderfields', signature: 'orderfields(S)', description: 'Order structure fields', category: 'Type' },
  { name: 'cellfun', signature: 'cellfun(FUNC, C)', description: 'Apply function to each cell', category: 'Type' },
  { name: 'arrayfun', signature: 'arrayfun(FUNC, A)', description: 'Apply function to each element', category: 'Type' },
  { name: 'structfun', signature: 'structfun(FUNC, S)', description: 'Apply function to each field', category: 'Type' },

  // Polynomial
  { name: 'poly', signature: 'poly(R)', description: 'Polynomial from roots', category: 'Polynomial' },
  { name: 'roots', signature: 'roots(P)', description: 'Polynomial roots', category: 'Polynomial' },
  { name: 'polyval', signature: 'polyval(P, X)', description: 'Evaluate polynomial', category: 'Polynomial' },
  { name: 'polyfit', signature: 'polyfit(X, Y, N)', description: 'Polynomial curve fitting', category: 'Polynomial' },
  { name: 'polyder', signature: 'polyder(P)', description: 'Polynomial derivative', category: 'Polynomial' },
  { name: 'polyint', signature: 'polyint(P)', description: 'Polynomial integration', category: 'Polynomial' },
  { name: 'polyval', signature: 'polyval(P, X)', description: 'Evaluate polynomial', category: 'Polynomial' },
  { name: 'deconv', signature: '[Q, R] = deconv(B, A)', description: 'Polynomial division', category: 'Polynomial' },
  { name: 'residue', signature: '[R, P, K] = residue(B, A)', description: 'Partial fraction expansion', category: 'Polynomial' },

  // Interpolation and numerical methods
  { name: 'interp1', signature: 'interp1(X, Y, XI, METHOD)', description: '1-D interpolation', category: 'Numerical' },
  { name: 'interp2', signature: 'interp2(X, Y, Z, XI, YI)', description: '2-D interpolation', category: 'Numerical' },
  { name: 'interp3', signature: 'interp3(V, XI, YI, ZI)', description: '3-D interpolation', category: 'Numerical' },
  { name: 'spline', signature: 'spline(X, Y, XI)', description: 'Cubic spline interpolation', category: 'Numerical' },
  { name: 'trapz', signature: 'trapz(X, Y)', description: 'Trapezoidal numerical integration', category: 'Numerical' },
  { name: 'cumtrapz', signature: 'cumtrapz(X, Y)', description: 'Cumulative trapezoidal integration', category: 'Numerical' },
  { name: 'quad', signature: 'quad(FUN, A, B)', description: 'Adaptive numerical integration', category: 'Numerical' },
  { name: 'quadl', signature: 'quadl(FUN, A, B)', description: 'Adaptive Lobatto integration', category: 'Numerical' },
  { name: 'diff', signature: 'diff(X, N)', description: 'Differences and approximate derivatives', category: 'Numerical' },
  { name: 'gradient', signature: 'gradient(F, H)', description: 'Numerical gradient', category: 'Numerical' },
  { name: 'fzero', signature: 'fzero(FUN, X0)', description: 'Find zero of function', category: 'Numerical' },
  { name: 'fminbnd', signature: 'fminbnd(FUN, X1, X2)', description: 'Find minimum of single-variable function', category: 'Numerical' },
  { name: 'fminsearch', signature: 'fminsearch(FUN, X0)', description: 'Find minimum of multivariable function', category: 'Numerical' },
  { name: 'fsolve', signature: 'fsolve(FUN, X0)', description: 'Solve system of nonlinear equations', category: 'Numerical' },
  { name: 'ode45', signature: '[T, Y] = ode45(ODEFUN, TSPAN, Y0)', description: 'Solve ODE (Runge-Kutta 4/5)', category: 'Numerical' },
  { name: 'ode23', signature: '[T, Y] = ode23(ODEFUN, TSPAN, Y0)', description: 'Solve ODE (Runge-Kutta 2/3)', category: 'Numerical' },
  { name: 'lsqnonneg', signature: 'lsqnonneg(A, B)', description: 'Non-negative least squares', category: 'Numerical' },

  // FFT / Signal
  { name: 'fft', signature: 'fft(X, N)', description: 'Fast Fourier transform', category: 'Signal' },
  { name: 'ifft', signature: 'ifft(X)', description: 'Inverse FFT', category: 'Signal' },
  { name: 'fft2', signature: 'fft2(X)', description: '2-D FFT', category: 'Signal' },
  { name: 'ifft2', signature: 'ifft2(X)', description: 'Inverse 2-D FFT', category: 'Signal' },
  { name: 'fftshift', signature: 'fftshift(X)', description: 'Shift zero-frequency to center', category: 'Signal' },
  { name: 'ifftshift', signature: 'ifftshift(X)', description: 'Inverse FFT shift', category: 'Signal' },
  { name: 'abs', signature: 'abs(X)', description: 'Magnitude (for FFT output)', category: 'Signal' },

  // Set operations
  { name: 'union', signature: 'union(A, B)', description: 'Set union', category: 'Set' },
  { name: 'intersect', signature: 'intersect(A, B)', description: 'Set intersection', category: 'Set' },
  { name: 'setdiff', signature: 'setdiff(A, B)', description: 'Set difference', category: 'Set' },
  { name: 'setxor', signature: 'setxor(A, B)', description: 'Set exclusive OR', category: 'Set' },
  { name: 'ismember', signature: 'ismember(A, B)', description: 'Set membership', category: 'Set' },
  { name: 'issorted', signature: 'issorted(A)', description: 'Check if sorted', category: 'Set' },

  // Logical
  { name: 'all', signature: 'all(A)', description: 'True if all elements nonzero', category: 'Logical' },
  { name: 'any', signature: 'any(A)', description: 'True if any element nonzero', category: 'Logical' },
  { name: 'xor', signature: 'xor(A, B)', description: 'Exclusive OR', category: 'Logical' },
  { name: 'not', signature: 'not(A)', description: 'Logical NOT', category: 'Logical' },
  { name: 'and', signature: 'and(A, B)', description: 'Logical AND', category: 'Logical' },
  { name: 'or', signature: 'or(A, B)', description: 'Logical OR', category: 'Logical' },

  // System / workspace
  { name: 'cd', signature: 'cd(DIR)', description: 'Change directory', category: 'System' },
  { name: 'pwd', signature: 'pwd', description: 'Current directory', category: 'System' },
  { name: 'ls', signature: 'ls', description: 'List directory', category: 'System' },
  { name: 'dir', signature: 'dir(NAME)', description: 'Directory listing', category: 'System' },
  { name: 'mkdir', signature: 'mkdir(DIR)', description: 'Make directory', category: 'System' },
  { name: 'rmdir', signature: 'rmdir(DIR)', description: 'Remove directory', category: 'System' },
  { name: 'delete', signature: 'delete(FILENAME)', description: 'Delete file', category: 'System' },
  { name: 'movefile', signature: 'movefile(SRC, DST)', description: 'Move or rename file', category: 'System' },
  { name: 'copyfile', signature: 'copyfile(SRC, DST)', description: 'Copy file', category: 'System' },
  { name: 'which', signature: 'which(NAME)', description: 'Locate function file', category: 'System' },
  { name: 'whos', signature: 'whos', description: 'List variables with details', category: 'System' },
  { name: 'who', signature: 'who', description: 'List workspace variables', category: 'System' },
  { name: 'clear', signature: 'clear VAR', description: 'Clear variables', category: 'System' },
  { name: 'clc', signature: 'clc', description: 'Clear command window', category: 'System' },
  { name: 'addpath', signature: 'addpath(DIR)', description: 'Add directory to search path', category: 'System' },
  { name: 'rmpath', signature: 'rmpath(DIR)', description: 'Remove directory from path', category: 'System' },
  { name: 'path', signature: 'path', description: 'Display search path', category: 'System' },
  { name: 'type', signature: 'type(NAME)', description: 'Display file contents', category: 'System' },
  { name: 'help', signature: 'help(NAME)', description: 'Display help text', category: 'System' },
  { name: 'doc', signature: 'doc(NAME)', description: 'Display documentation', category: 'System' },
  { name: 'run', signature: 'run(SCRIPT)', description: 'Run script', category: 'System' },
  { name: 'system', signature: '[STATUS, OUTPUT] = system(CMD)', description: 'Execute system command', category: 'System' },
  { name: 'tic', signature: 'tic', description: 'Start timer', category: 'System' },
  { name: 'toc', signature: 'toc', description: 'Read elapsed time', category: 'System' },
  { name: 'pause', signature: 'pause(N)', description: 'Pause execution', category: 'System' },
  { name: 'tempdir', signature: 'tempdir', description: 'Get temporary directory path', category: 'System' },
  { name: 'tempname', signature: 'tempname', description: 'Get unique temporary file name', category: 'System' },
  { name: 'fullfile', signature: 'fullfile(DIR, FILE)', description: 'Build full file path', category: 'System' },
  { name: 'fileparts', signature: '[DIR, NAME, EXT] = fileparts(FILE)', description: 'Parts of file name', category: 'System' },
  { name: 'filesep', signature: 'filesep', description: 'File separator character', category: 'System' },
  { name: 'pathsep', signature: 'pathsep', description: 'Path separator character', category: 'System' },

  // Constants
  { name: 'pi', signature: 'pi', description: 'Ratio of circumference to diameter (3.14159...)', category: 'Constant' },
  { name: 'eps', signature: 'eps', description: 'Machine epsilon', category: 'Constant' },
  { name: 'Inf', signature: 'Inf', description: 'Infinity', category: 'Constant' },
  { name: 'NaN', signature: 'NaN', description: 'Not-a-Number', category: 'Constant' },
  { name: 'i', signature: 'i', description: 'Imaginary unit', category: 'Constant' },
  { name: 'j', signature: 'j', description: 'Imaginary unit', category: 'Constant' },
  { name: 'e', signature: 'e', description: "Euler's number (2.71828...)", category: 'Constant' },
  { name: 'realmin', signature: 'realmin', description: 'Smallest positive floating-point number', category: 'Constant' },
  { name: 'realmax', signature: 'realmax', description: 'Largest floating-point number', category: 'Constant' },
  { name: 'intmax', signature: 'intmax(TYPE)', description: 'Largest integer value', category: 'Constant' },
  { name: 'intmin', signature: 'intmin(TYPE)', description: 'Smallest integer value', category: 'Constant' },
]

// Module-level state that React components can update
interface CompletionContext {
  workspaceVariables: Array<{ name: string; class: string; size: string }>
  mFileNames: string[]
}

const completionContext: CompletionContext = {
  workspaceVariables: [],
  mFileNames: [],
}

/** Update workspace variables for auto-complete suggestions */
export function updateWorkspaceVariables(
  variables: Array<{ name: string; class: string; size: string }>
): void {
  completionContext.workspaceVariables = variables
}

/** Update .m file names for auto-complete suggestions */
export function updateMFileNames(names: string[]): void {
  completionContext.mFileNames = names
}

/** Create the MATLAB completion item provider for Monaco */
export function createMatlabCompletionProvider(
  monaco: typeof import('monaco-editor')
): languages.CompletionItemProvider {
  return {
    triggerCharacters: [],

    provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
      _context: languages.CompletionContext,
      _token: CancellationToken
    ): languages.ProviderResult<languages.CompletionList> {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      // Only suggest after 2+ characters typed
      if (word.word.length < 2) {
        return { suggestions: [] }
      }

      const suggestions: languages.CompletionItem[] = []

      // 1. Built-in functions
      for (const builtin of OCTAVE_BUILTINS) {
        suggestions.push({
          label: builtin.name,
          kind: builtin.category === 'Constant'
            ? monaco.languages.CompletionItemKind.Constant
            : monaco.languages.CompletionItemKind.Function,
          insertText: builtin.name,
          detail: builtin.signature,
          documentation: `${builtin.description} [${builtin.category}]`,
          range,
          sortText: `1_${builtin.name}`,
        })
      }

      // 2. Workspace variables
      for (const v of completionContext.workspaceVariables) {
        suggestions.push({
          label: v.name,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: v.name,
          detail: `${v.size} ${v.class}`,
          documentation: `Workspace variable: ${v.name} (${v.size} ${v.class})`,
          range,
          sortText: `0_${v.name}`,
        })
      }

      // 3. .m file function names (from current directory)
      for (const name of completionContext.mFileNames) {
        // Strip .m extension to get the function name
        const funcName = name.replace(/\.m$/, '')
        suggestions.push({
          label: funcName,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: funcName,
          detail: `${name} (local file)`,
          documentation: `User-defined function from ${name}`,
          range,
          sortText: `0_${funcName}`,
        })
      }

      // Deduplicate by label (workspace vars and .m files may overlap with builtins)
      const seen = new Set<string>()
      const deduped: languages.CompletionItem[] = []
      for (const s of suggestions) {
        const label = typeof s.label === 'string' ? s.label : s.label.label
        if (!seen.has(label)) {
          seen.add(label)
          deduped.push(s)
        }
      }

      return { suggestions: deduped }
    },
  }
}
